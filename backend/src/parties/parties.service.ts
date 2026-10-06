import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SafesService } from '../safes/safes.service';
import { CreatePartyDto } from './dto/create-party.dto';
import { UpdatePartyDto } from './dto/update-party.dto';
import { CreateDrawingDto } from './dto/create-drawing.dto';
import { CreateDeferredDto } from './dto/create-deferred.dto';
import { CreateDeferredPaymentDto } from './dto/create-deferred-payment.dto';
import { CreateSettlementDto, SettlementApplicationMode } from './dto/create-settlement.dto';
import { CancelDrawingDto } from './dto/cancel-drawing.dto';

type Tx = Prisma.TransactionClient;

@Injectable()
export class PartiesService {
  constructor(
    private prisma: PrismaService,
    private safes: SafesService,
  ) {}

  /**
   * Looks up the category to stamp on an auto-generated ledger transaction
   * by its `partyType`+`kind` flags rather than a display name — a
   * category's name is user-editable and renaming it must never silently
   * break this linkage (it already had, once, on live data). Deliberately
   * NOT cached: an in-process cache here previously reintroduced the exact
   * same class of staleness bug (an admin re-tagging which category is
   * AGENT/MERCHANT mid-session would keep silently using the old id) —
   * this is a single indexed lookup, not worth the risk.
   */
  private async findCategoryIdByPartyType(
    partyType: 'AGENT' | 'MERCHANT',
    kind: 'IN' | 'OUT',
  ): Promise<string | undefined> {
    const category = await this.prisma.category.findFirst({ where: { partyType, kind, active: true } });
    return category?.id;
  }

  /**
   * Looks up a fixed-role category by its systemKey rather than
   * partyType+kind — needed once more than one category shares the same
   * partyType+kind pair (e.g. رواسل and مسحوبات are both OUT+MERCHANT),
   * where findCategoryIdByPartyType's findFirst would be ambiguous.
   */
  private async findCategoryIdBySystemKey(systemKey: string): Promise<string | undefined> {
    const category = await this.prisma.category.findUnique({ where: { systemKey } });
    return category?.id;
  }

  /**
   * Attaches a `PartyDrawing` row to an already-created OUT Transaction —
   * shared by createDrawing() (the dedicated مسحوبات flow) and
   * TransactionsService (an expense recorded under the merchant/drawing
   * category from المصروفات), so both entry points produce the exact same
   * bookkeeping instead of silently diverging.
   */
  async recordDrawing(
    tx: Tx,
    params: { partyId: string; safeId: string; amount: number; note?: string | null; transactionId: string },
  ) {
    return tx.partyDrawing.create({
      data: {
        partyId: params.partyId,
        safeId: params.safeId,
        amount: params.amount,
        transactionId: params.transactionId,
        note: params.note ?? undefined,
      },
    });
  }

  /**
   * Keeps a Transaction's linked PartyDrawing in sync with it whenever the
   * transaction is edited or voided — called from TransactionsService's
   * update()/void(). Without this, editing a drawing-linked transaction's
   * amount/party/category (or voiding it) left the PartyDrawing row
   * pointing at stale data, permanently skewing totalDrawings/
   * netOutstanding. `params: null` means the transaction no longer
   * qualifies as a drawing (voided, or edited away from OUT+MERCHANT) —
   * the linked drawing is removed entirely rather than left orphaned.
   */
  async syncDrawingForTransaction(
    tx: Tx,
    transactionId: string,
    params: { partyId: string; safeId: string; amount: number; note?: string | null } | null,
  ) {
    const existing = await tx.partyDrawing.findFirst({ where: { transactionId } });
    if (!params) {
      if (existing) await tx.partyDrawing.delete({ where: { id: existing.id } });
      return;
    }
    if (existing) {
      await tx.partyDrawing.update({
        where: { id: existing.id },
        data: {
          partyId: params.partyId,
          safeId: params.safeId,
          amount: params.amount,
          note: params.note ?? undefined,
        },
      });
    } else {
      await this.recordDrawing(tx, { ...params, transactionId });
    }
  }

  /**
   * Keeps a Transaction's FIFO-applied PartyDeferredPayment rows in sync
   * with it — the deferred-balance analogue of syncDrawingForTransaction
   * above (see its docstring for the edit/void staleness problem this
   * solves; same pattern, but FIFO-multi-row instead of single-row since
   * one income transaction can spill across several open PartyDeferred
   * records). Called from TransactionsService's create()/update()/void()
   * whenever an IN transaction is recorded against an AGENT party.
   *
   * `params: null` means the transaction no longer qualifies (voided, or
   * edited away from IN+AGENT) — all linked payments are reversed.
   * Reversal always runs first even when new params are supplied, so
   * re-running this on an edit is idempotent instead of double-applying.
   */
  async syncDeferredPaymentForTransaction(
    tx: Tx,
    transactionId: string,
    params: { partyId: string; safeId: string; amount: number; note?: string | null } | null,
  ) {
    const existingPayments = await tx.partyDeferredPayment.findMany({ where: { transactionId } });
    for (const payment of existingPayments) {
      await tx.partyDeferred.update({
        where: { id: payment.deferredId },
        data: { remainingAmount: { increment: payment.amount } },
      });
    }
    if (existingPayments.length) {
      await tx.partyDeferredPayment.deleteMany({ where: { transactionId } });
    }

    if (!params) return;

    let remainingToApply = params.amount;
    const openDeferred = await tx.partyDeferred.findMany({
      where: { partyId: params.partyId, remainingAmount: { gt: 0 } },
      orderBy: { createdAt: 'asc' },
    });

    for (const row of openDeferred) {
      if (remainingToApply <= 0) break;
      const applied = Math.min(remainingToApply, Number(row.remainingAmount));
      if (applied <= 0) continue;
      await tx.partyDeferred.update({
        where: { id: row.id },
        data: { remainingAmount: { decrement: applied } },
      });
      await tx.partyDeferredPayment.create({
        data: {
          deferredId: row.id,
          safeId: params.safeId,
          amount: applied,
          transactionId,
        },
      });
      remainingToApply -= applied;
    }
    // Any leftover remainingToApply stays unapplied — it's already
    // recorded as plain income via the transaction itself, no special
    // handling needed for the excess.
  }

  /**
   * Live (non-cancelled, non-voided) drawings for a party with their
   * applied/remaining amounts, derived from WithdrawalApplication rather
   * than the old redeposit-category netting hack — this is the single
   * source of truth for "outstanding withdrawals" everywhere (summary(),
   * the مسحوبات page/tab, settlement creation). Replaces the retired
   * computeDrawingsTotal()/getOutstandingDrawingsTotal() pair.
   */
  async getOutstandingDrawings(partyId: string, start?: string, end?: string) {
    const drawingsWhere: any = { partyId, cancelled: false };
    if (start || end) {
      drawingsWhere.date = {};
      if (start) drawingsWhere.date.gte = new Date(start);
      if (end) drawingsWhere.date.lte = new Date(end);
    }
    const drawings = await this.prisma.partyDrawing.findMany({
      where: drawingsWhere,
      orderBy: { date: 'asc' },
    });

    // A drawing's underlying Transaction can be voided after the fact —
    // TransactionsService.void() already removes the PartyDrawing row via
    // syncDrawingForTransaction, but this is a defensive backstop for any
    // row touched by another path.
    const drawingTxIds = drawings.map((d) => d.transactionId).filter((v): v is string => !!v);
    const voidedTxIds = drawingTxIds.length
      ? new Set(
          (
            await this.prisma.transaction.findMany({
              where: { id: { in: drawingTxIds }, status: 'VOIDED' },
              select: { id: true },
            })
          ).map((t) => t.id),
        )
      : new Set<string>();
    const liveDrawings = drawings.filter((d) => !d.transactionId || !voidedTxIds.has(d.transactionId));

    const drawingIds = liveDrawings.map((d) => d.id);
    const appliedSums = drawingIds.length
      ? await this.prisma.withdrawalApplication.groupBy({
          by: ['drawingId'],
          where: { drawingId: { in: drawingIds } },
          _sum: { amount: true },
        })
      : [];
    const appliedByDrawing = new Map(appliedSums.map((a) => [a.drawingId, Number(a._sum.amount ?? 0)]));

    const rows = liveDrawings.map((d) => {
      const amount = Number(d.amount);
      const appliedAmount = appliedByDrawing.get(d.id) ?? 0;
      const remaining = Math.max(0, amount - appliedAmount);
      const status = remaining <= 0 ? 'APPLIED' : appliedAmount > 0 ? 'PARTIALLY_APPLIED' : 'OPEN';
      return { ...d, amount, appliedAmount, remaining, status };
    });

    const totalOutstanding = rows.reduce((sum, r) => sum + r.remaining, 0);
    return { rows, totalOutstanding };
  }

  /**
   * Total outstanding (not yet applied) withdrawals for a party — thin
   * wrapper over getOutstandingDrawings() kept for callers that only need
   * the number (summary()'s netOutstanding, dashboard aggregates).
   */
  async getOutstandingDrawingsTotal(partyId: string): Promise<number> {
    const { totalOutstanding } = await this.getOutstandingDrawings(partyId);
    return totalOutstanding;
  }

  findAll(partyType?: string, q?: string) {
    return this.prisma.party.findMany({
      where: {
        active: true,
        ...(partyType ? { partyType } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { province: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const party = await this.prisma.party.findUnique({ where: { id } });
    if (!party) throw new NotFoundException('Party not found');
    return party;
  }

  async create(dto: CreatePartyDto) {
    const existing = await this.prisma.party.findUnique({ where: { name: dto.name.trim() } });
    if (existing) throw new ConflictException('اسم الجهة موجود بالفعل');
    return this.prisma.party.create({
      data: {
        name: dto.name.trim(),
        partyType: dto.partyType,
        province: dto.province?.trim(),
        phone: dto.phone?.trim(),
        notes: dto.notes?.trim(),
      },
    });
  }

  async update(id: string, dto: UpdatePartyDto) {
    await this.findOne(id);
    return this.prisma.party.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.party.update({ where: { id }, data: { active: false } });
  }

  /** Distinct party types in use, defaulting to the two canonical values
   * when nothing custom has been added yet. */
  async listTypes(): Promise<string[]> {
    const DEFAULTS = ['AGENT', 'MERCHANT'];
    const partyTypes = await this.prisma.party.findMany({ distinct: ['partyType'], select: { partyType: true } });
    const used = new Set<string>([...DEFAULTS, ...partyTypes.map((p) => p.partyType)]);
    return Array.from(used);
  }

  /**
   * Mirrors the old app's /api/parties/{pid}/summary: AGENT parties are
   * summarized by IN transactions (income collected through them), MERCHANT
   * parties by OUT transactions (payouts to them) — same asymmetry as
   * `party_summary()` in app/main.py.
   */
  async summary(id: string, start?: string, end?: string) {
    const party = await this.findOne(id);
    const kind = party.partyType === 'AGENT' ? 'IN' : 'OUT';
    const where: any = { partyId: id, kind, status: 'POSTED' };
    if (start || end) {
      where.createdAt = {};
      if (start) where.createdAt.gte = new Date(start);
      if (end) where.createdAt.lte = new Date(end);
    }
    const [agg, transactions] = await Promise.all([
      this.prisma.transaction.aggregate({
        where,
        _sum: { amount: true },
        _count: true,
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { safe: true, category: true },
      }),
    ]);

    // Built with Prisma.sql tagged fragments rather than $queryRawUnsafe's
    // manual placeholder-index string interpolation — every value here is
    // still parameterized either way, but this form can't silently drift
    // out of sync ($N numbering) if the WHERE clause is ever edited again.
    const dateFilter = Prisma.sql`${start ? Prisma.sql`AND created_at >= ${new Date(start)}` : Prisma.empty}${
      end ? Prisma.sql` AND created_at <= ${new Date(end)}` : Prisma.empty
    }`;
    const byMonthRaw = await this.prisma.$queryRaw<{ month: string; total: string; count: bigint }[]>`
      SELECT to_char("created_at", 'YYYY-MM') as month, SUM(amount)::text as total, COUNT(*) as count
      FROM transactions WHERE party_id = ${id} AND kind = ${kind}::"TransactionKind" AND status = 'POSTED'
      ${dateFilter}
      GROUP BY month ORDER BY month DESC
    `;

    // Drawings/applications respect the same start/end window as the rest
    // of this summary — previously totalDrawings always reflected the
    // party's entire history even when a narrower range was requested.
    const [{ rows: drawingRows, totalOutstanding }, deferred] = await Promise.all([
      this.getOutstandingDrawings(id, start, end),
      this.prisma.partyDeferred.findMany({ where: { partyId: id }, include: { payments: true } }),
    ]);

    const totalWithdrawn = drawingRows.reduce((sum, d) => sum + d.amount, 0);
    const totalApplied = drawingRows.reduce((sum, d) => sum + d.appliedAmount, 0);

    const totalDeferredOriginal = deferred.reduce((sum, d) => sum + Number(d.originalAmount), 0);
    const totalDeferredRemaining = deferred.reduce((sum, d) => sum + Number(d.remainingAmount), 0);
    const totalDeferredPaid = totalDeferredOriginal - totalDeferredRemaining;

    return {
      party,
      metric: party.partyType === 'AGENT' ? 'income' : 'payout',
      total: Number(agg._sum.amount ?? 0),
      count: agg._count,
      firstDate: agg._min.createdAt,
      lastDate: agg._max.createdAt,
      transactions,
      byMonth: byMonthRaw.map((r) => ({ month: r.month, total: Number(r.total), count: Number(r.count) })),
      // totalDrawings kept as the outstanding figure for backward
      // compatibility with existing frontend readers of this field — the
      // new totalWithdrawn/totalApplied/totalDrawings (outstanding) triplet
      // is what the مسحوبات page/tab actually surfaces now.
      totalDrawings: totalOutstanding,
      totalWithdrawn,
      totalApplied,
      totalDeferredOriginal,
      totalDeferredPaid,
      totalDeferredRemaining,
      netOutstanding: totalOutstanding + totalDeferredRemaining,
      drawingsCount: drawingRows.length,
      outstandingDrawingsCount: drawingRows.filter((d) => d.remaining > 0).length,
      deferredCount: deferred.length,
    };
  }

  /**
   * Unified chronological كشف حساب feed (Phase 34d), mirroring
   * CouriersService.statement()'s shape and same no-cross-netting
   * discipline — each event carries only its own amount/direction, no
   * running balance across mixed types. Unlike couriers (where every
   * Transaction already belongs to one of three dedicated flows), a
   * party's Transaction rows are a MIX of dedicated-flow money movements
   * (drawings, settlements, deferred payments — which already have a
   * richer side-table event below) and plain generic transactions (a
   * رواسل expense with nothing to settle, plain income, a custom
   * category...). To avoid showing a drawing/settlement/deferred-payment
   * twice, the generic TRANSACTION event excludes any row already
   * represented by a DRAWING/SETTLEMENT/DEFERRED_PAYMENT event via its
   * `transactionId` link.
   */
  async statement(partyId: string, start?: string, end?: string) {
    await this.findOne(partyId);
    const dateFilter: any = {};
    if (start || end) {
      dateFilter.gte = start ? new Date(start) : undefined;
      dateFilter.lte = end ? new Date(end) : undefined;
    }
    const hasDateFilter = start || end;

    const [rawDrawings, settlements, deferred, deferredPayments] = await Promise.all([
      this.prisma.partyDrawing.findMany({
        where: { partyId, cancelled: false, ...(hasDateFilter ? { date: dateFilter } : {}) },
        include: { safe: true },
      }),
      this.prisma.partySettlement.findMany({
        where: { partyId, ...(hasDateFilter ? { date: dateFilter } : {}) },
        include: { safe: true },
      }),
      this.prisma.partyDeferred.findMany({
        where: { partyId, ...(hasDateFilter ? { createdAt: dateFilter } : {}) },
      }),
      this.prisma.partyDeferredPayment.findMany({
        where: { deferred: { partyId }, ...(hasDateFilter ? { date: dateFilter } : {}) },
        include: { safe: true, deferred: true },
      }),
    ]);

    // Per-drawing applied sums — how much of EACH drawing is still
    // outstanding, right now (not a point-in-time-at-creation figure, same
    // "current state" convention used everywhere else outstanding is shown).
    const drawingIds = rawDrawings.map((d) => d.id);
    const appliedSums = drawingIds.length
      ? await this.prisma.withdrawalApplication.groupBy({
          by: ['drawingId'],
          where: { drawingId: { in: drawingIds } },
          _sum: { amount: true },
        })
      : [];
    const appliedByDrawing = new Map(appliedSums.map((a) => [a.drawingId, Number(a._sum.amount ?? 0)]));
    const drawings = rawDrawings.map((d) => {
      const remaining = Math.max(0, Number(d.amount) - (appliedByDrawing.get(d.id) ?? 0));
      return { ...d, remaining, settled: remaining <= 0 };
    });

    const representedTransactionIds = new Set(
      [...drawings, ...settlements, ...deferredPayments]
        .map((r) => r.transactionId)
        .filter((id): id is string => !!id),
    );

    const transactions = await this.prisma.transaction.findMany({
      where: {
        partyId,
        status: 'POSTED',
        id: { notIn: Array.from(representedTransactionIds) },
        ...(hasDateFilter ? { createdAt: dateFilter } : {}),
      },
      include: { safe: true, category: true },
    });

    const events = [
      ...transactions.map((t) => ({
        type: 'TRANSACTION' as const,
        date: t.createdAt,
        amount: Number(t.amount),
        direction: t.kind as 'IN' | 'OUT',
        safe: t.safe,
        note: t.description ?? t.category?.name ?? null,
        id: t.id,
      })),
      ...drawings.map((d) => ({
        type: 'DRAWING' as const,
        date: d.date,
        amount: Number(d.amount),
        direction: 'OUT' as const,
        safe: d.safe,
        note: d.note,
        id: d.id,
        // How much of THIS specific drawing is still unapplied, right now.
        remaining: d.remaining,
        settled: d.settled,
      })),
      ...settlements.map((s) => ({
        type: 'SETTLEMENT' as const,
        date: s.date,
        amount: Number(s.netAmount),
        direction: 'OUT' as const,
        safe: s.safe,
        note: s.note ?? `تسوية راسل — إجمالي ${Number(s.grossAmount).toLocaleString()} / مطبق ${Number(s.appliedAmount).toLocaleString()}`,
        id: s.id,
      })),
      ...deferred.map((d) => ({
        type: 'DEFERRED' as const,
        date: d.createdAt,
        amount: Number(d.originalAmount),
        direction: 'OUT' as const,
        safe: null,
        note: null as string | null,
        id: d.id,
        // This specific آجل record's own remaining balance.
        remaining: Number(d.remainingAmount),
        settled: Number(d.remainingAmount) <= 0,
      })),
      ...deferredPayments.map((p) => ({
        type: 'DEFERRED_PAYMENT' as const,
        date: p.date,
        amount: Number(p.amount),
        direction: 'IN' as const,
        safe: p.safe,
        note: null as string | null,
        id: p.id,
        // The parent آجل record's current remaining balance after whatever
        // payments have been made against it so far (not just this one).
        remaining: Number(p.deferred.remainingAmount),
        settled: Number(p.deferred.remainingAmount) <= 0,
      })),
    ];

    return events.sort((a, b) => +new Date(b.date) - +new Date(a.date));
  }

  // ---- مسحوبات (drawings) ----

  /**
   * Full drawing ledger for the party-detail/standalone مسحوبات UI,
   * including cancelled rows (shown with status CANCELLED, not hidden) —
   * unlike getOutstandingDrawings(), which deliberately excludes cancelled
   * rows since they're never eligible for settlement application.
   */
  async listDrawings(partyId: string) {
    const [drawings, applicationSums] = await Promise.all([
      this.prisma.partyDrawing.findMany({ where: { partyId }, orderBy: { date: 'desc' } }),
      this.prisma.withdrawalApplication.groupBy({
        by: ['drawingId'],
        where: { drawing: { partyId } },
        _sum: { amount: true },
      }),
    ]);
    const appliedByDrawing = new Map(applicationSums.map((a) => [a.drawingId, Number(a._sum.amount ?? 0)]));

    return drawings.map((d) => {
      const amount = Number(d.amount);
      const appliedAmount = appliedByDrawing.get(d.id) ?? 0;
      const remaining = Math.max(0, amount - appliedAmount);
      const status = d.cancelled
        ? 'CANCELLED'
        : remaining <= 0 && appliedAmount > 0
          ? 'APPLIED'
          : appliedAmount > 0
            ? 'PARTIALLY_APPLIED'
            : 'OPEN';
      return { ...d, amount, appliedAmount, remaining, status };
    });
  }

  /**
   * Administrative cancellation of a data-entry mistake — never a reversal
   * of real money (see schema comment on PartyDrawing.cancelled). Blocked
   * once anything has been applied against this drawing: that money is now
   * tied to a real settlement's net-cash math and can't retroactively
   * vanish from a cancelled record.
   */
  async cancelDrawing(partyId: string, drawingId: string, dto: CancelDrawingDto, userId: string | undefined) {
    const drawing = await this.prisma.partyDrawing.findUnique({ where: { id: drawingId } });
    if (!drawing || drawing.partyId !== partyId) {
      throw new NotFoundException('المسحوب غير موجود لهذه الجهة');
    }
    if (drawing.cancelled) {
      throw new BadRequestException('هذا المسحوب ملغى بالفعل');
    }
    const appliedAmount = await this.prisma.withdrawalApplication.aggregate({
      where: { drawingId },
      _sum: { amount: true },
    });
    if (Number(appliedAmount._sum.amount ?? 0) > 0) {
      throw new BadRequestException('لا يمكن إلغاء مسحوب تم تطبيقه جزئيًا أو كليًا على تسوية');
    }
    return this.prisma.partyDrawing.update({
      where: { id: drawingId },
      data: {
        cancelled: true,
        cancelledAt: new Date(),
        cancelledById: userId,
        cancelledNote: dto.note,
      },
    });
  }

  /** Settlements this specific drawing has contributed to, newest first —
   * the "application history" view on a drawing's row. */
  getDrawingApplicationHistory(drawingId: string) {
    return this.prisma.withdrawalApplication.findMany({
      where: { drawingId },
      include: { settlement: { include: { safe: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Records a drawing: atomically creates the OUT transaction against the
   * chosen safe and the party_drawings row referencing it, inside one
   * Prisma $transaction so a failure never leaves an orphaned transaction
   * or a drawing with no matching ledger entry.
   */
  async createDrawing(partyId: string, dto: CreateDrawingDto, createdById: string | undefined) {
    await this.findOne(partyId);

    // No "one outstanding at a time" guard here — a مسحوبات is a partial
    // draw against the party's full amount, and multiple partial draws
    // over time are normal (e.g. 10,000 drawn from a 30,000 total, then
    // more later). Only a رواسل (or other non-drawing) expense is blocked
    // by an outstanding drawing — see TransactionsService.create().
    const categoryId = await this.findCategoryIdBySystemKey('MERCHANT_DRAWING');

    return this.prisma.$transaction(async (tx) => {
      const safe = await tx.safe.findUnique({ where: { id: dto.safeId } });
      if (!safe) throw new NotFoundException('Safe not found');

      // Balance can never go negative — a drawing is a real cash-out.
      await this.safes.assertSufficientBalance(dto.safeId, dto.amount, tx as any);

      const transaction = await tx.transaction.create({
        data: {
          safeId: dto.safeId,
          kind: 'OUT',
          amount: dto.amount,
          partyId,
          categoryId,
          description: dto.note ?? 'مسحوبات راسل',
          createdById,
        },
      });

      return this.recordDrawing(tx, {
        partyId,
        safeId: dto.safeId,
        amount: dto.amount,
        note: dto.note,
        transactionId: transaction.id,
      });
    });
  }

  // ---- آجل (deferred) ----

  listDeferred(partyId: string) {
    return this.prisma.partyDeferred.findMany({
      where: { partyId },
      include: { payments: { orderBy: { date: 'desc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createDeferred(partyId: string, dto: CreateDeferredDto) {
    await this.findOne(partyId);
    return this.prisma.partyDeferred.create({
      data: {
        partyId,
        originalAmount: dto.originalAmount,
        remainingAmount: dto.originalAmount,
      },
    });
  }

  /**
   * Records a payment against an outstanding deferred (آجل) balance:
   * atomically creates the IN transaction, the party_deferred_payments
   * row, and decrements party_deferred.remaining_amount, all inside one
   * Prisma $transaction. Rejects payments that would overpay the balance.
   */
  async createDeferredPayment(
    partyId: string,
    deferredId: string,
    dto: CreateDeferredPaymentDto,
    createdById: string | undefined,
  ) {
    await this.findOne(partyId); // throws if the party doesn't exist or is inactive
    const categoryId = await this.findCategoryIdByPartyType('AGENT', 'IN');

    return this.prisma.$transaction(async (tx) => {
      const deferred = await tx.partyDeferred.findUnique({ where: { id: deferredId } });
      if (!deferred || deferred.partyId !== partyId) {
        throw new NotFoundException('Deferred record not found for this party');
      }

      const remaining = Number(deferred.remainingAmount);
      if (dto.amount > remaining) {
        throw new BadRequestException(
          `Payment (${dto.amount}) exceeds remaining deferred balance (${remaining})`,
        );
      }

      const safe = await tx.safe.findUnique({ where: { id: dto.safeId } });
      if (!safe) throw new NotFoundException('Safe not found');

      const transaction = await tx.transaction.create({
        data: {
          safeId: dto.safeId,
          kind: 'IN',
          amount: dto.amount,
          partyId,
          categoryId,
          description: 'دفعة آجل',
          createdById,
        },
      });

      const payment = await tx.partyDeferredPayment.create({
        data: {
          deferredId,
          safeId: dto.safeId,
          amount: dto.amount,
          transactionId: transaction.id,
        },
      });

      const updatedDeferred = await tx.partyDeferred.update({
        where: { id: deferredId },
        data: { remainingAmount: remaining - dto.amount },
      });

      return { payment, deferred: updatedDeferred };
    });
  }

  // ---- تسوية الراسل (sender settlement) ----

  listSettlements(partyId: string) {
    return this.prisma.partySettlement.findMany({
      where: { partyId },
      include: { safe: true, applications: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Records a سرواسل settlement: the party's gross collection for the
   * period, how much of it is applied against outstanding withdrawals, and
   * the net cash that actually leaves the safe. A withdrawal is NEVER
   * reversed/re-entered/edited here — applying it only records a
   * WithdrawalApplication row; the original drawing Transaction stays
   * exactly as posted. Mirrors syncDeferredPaymentForTransaction's FIFO
   * reversal-then-reapply shape, generalized to span many drawings and one
   * settlement instead of one transaction and many deferred records.
   *
   * Hard (blocking) validation only for actual data-integrity violations —
   * negative/zero amounts, an over-application beyond a single drawing's
   * remaining balance, an over-application beyond the settlement's gross
   * amount, an unknown sender/safe, insufficient safe balance, or a
   * double-submission race (caught via the unique clientRequestId). Every
   * other legitimate business choice (outstanding balance left untouched,
   * withdrawals exceeding the gross amount, carrying forward) is reported
   * back via `warnings`, never blocked.
   */
  async createSettlement(partyId: string, dto: CreateSettlementDto, createdById: string | undefined) {
    const party = await this.findOne(partyId);
    if (party.partyType !== 'MERCHANT') {
      throw new BadRequestException('التسوية متاحة فقط لجهات الرواسل (MERCHANT)');
    }
    // Re-checked here (not just via the DTO's @IsPositive()) since the
    // approval-queue dispatch path (PendingActionsService) calls this
    // service method directly with a raw stored payload that never passed
    // through class-validator — see ApprovalInterceptor's docstring.
    if (!dto.grossAmount || dto.grossAmount <= 0) {
      throw new BadRequestException('إجمالي التسوية يجب أن يكون أكبر من صفر');
    }

    if (dto.clientRequestId) {
      const existing = await this.prisma.partySettlement.findUnique({
        where: { clientRequestId: dto.clientRequestId },
        include: { applications: true },
      });
      if (existing) return { ...existing, warnings: [] as string[] };
    }

    const categoryId = await this.findCategoryIdBySystemKey('MERCHANT_SENDER');

    return this.prisma.$transaction(async (tx) => {
      const safe = await tx.safe.findUnique({ where: { id: dto.safeId } });
      if (!safe) throw new NotFoundException('Safe not found');

      // FIFO-ordered, live outstanding drawings for this party — same
      // live-derived-from-WithdrawalApplication shape as
      // getOutstandingDrawings(), re-fetched inside this $transaction so
      // concurrent settlements can't both read the same stale "remaining".
      const drawings = await tx.partyDrawing.findMany({
        where: { partyId, cancelled: false },
        orderBy: { date: 'asc' },
      });
      const drawingIds = drawings.map((d) => d.id);
      const appliedSums = drawingIds.length
        ? await tx.withdrawalApplication.groupBy({
            by: ['drawingId'],
            where: { drawingId: { in: drawingIds } },
            _sum: { amount: true },
          })
        : [];
      const appliedByDrawing = new Map(appliedSums.map((a) => [a.drawingId, Number(a._sum.amount ?? 0)]));
      const outstanding = drawings
        .map((d) => ({
          id: d.id,
          remaining: Math.max(0, Number(d.amount) - (appliedByDrawing.get(d.id) ?? 0)),
        }))
        .filter((d) => d.remaining > 0);

      const warnings: string[] = [];
      const allocations: { drawingId: string; amount: number }[] = [];

      if (dto.applicationMode === SettlementApplicationMode.ALL) {
        let left = dto.grossAmount;
        for (const d of outstanding) {
          if (left <= 0) break;
          const amount = Math.min(d.remaining, left);
          if (amount <= 0) continue;
          allocations.push({ drawingId: d.id, amount });
          left -= amount;
        }
      } else if (dto.applicationMode === SettlementApplicationMode.CUSTOM_TOTAL) {
        const totalOutstanding = outstanding.reduce((sum, d) => sum + d.remaining, 0);
        let target = Math.min(dto.customTotal ?? 0, totalOutstanding, dto.grossAmount);
        if ((dto.customTotal ?? 0) > totalOutstanding) {
          warnings.push('تم تطبيق أقل من المبلغ المطلوب لعدم كفاية المسحوبات القائمة');
        }
        for (const d of outstanding) {
          if (target <= 0) break;
          const amount = Math.min(d.remaining, target);
          if (amount <= 0) continue;
          allocations.push({ drawingId: d.id, amount });
          target -= amount;
        }
      } else if (dto.applicationMode === SettlementApplicationMode.SPECIFIC) {
        const outstandingById = new Map(outstanding.map((d) => [d.id, d.remaining]));
        for (const item of dto.specificApplications ?? []) {
          const remaining = outstandingById.get(item.drawingId);
          if (remaining === undefined) {
            throw new BadRequestException('أحد المسحوبات المختارة لا يخص هذه الجهة أو غير قائم');
          }
          if (item.amount > remaining + 0.005) {
            throw new BadRequestException(
              `المبلغ المطبق (${item.amount}) يتجاوز المتبقي من هذا المسحوب (${remaining})`,
            );
          }
          allocations.push({ drawingId: item.drawingId, amount: item.amount });
        }
      }
      // NONE: allocations stays empty, nothing is touched — carry forward.

      const appliedAmount = allocations.reduce((sum, a) => sum + a.amount, 0);
      if (appliedAmount > dto.grossAmount + 0.005) {
        throw new BadRequestException('إجمالي المبلغ المطبق يتجاوز إجمالي التسوية');
      }

      const netAmount = Math.max(0, dto.grossAmount - appliedAmount);
      const remainingOutstandingAfter =
        outstanding.reduce((sum, d) => sum + d.remaining, 0) - appliedAmount;
      if (remainingOutstandingAfter > 0.005) {
        warnings.push('لا يزال هناك مسحوبات قائمة بعد هذه التسوية');
      }

      let transactionId: string | null = null;
      if (netAmount > 0) {
        await this.safes.assertSufficientBalance(dto.safeId, netAmount, tx as any);
        const transaction = await tx.transaction.create({
          data: {
            safeId: dto.safeId,
            kind: 'OUT',
            amount: netAmount,
            partyId,
            categoryId,
            description: dto.note ?? 'تسوية راسل',
            createdById,
            createdAt: dto.date ? new Date(dto.date) : undefined,
          },
        });
        transactionId = transaction.id;
      }

      const settlement = await tx.partySettlement.create({
        data: {
          partyId,
          safeId: dto.safeId,
          grossAmount: dto.grossAmount,
          appliedAmount,
          netAmount,
          transactionId,
          note: dto.note,
          date: dto.date ? new Date(dto.date) : undefined,
          createdById,
          clientRequestId: dto.clientRequestId,
        },
      });

      if (allocations.length) {
        await tx.withdrawalApplication.createMany({
          data: allocations.map((a) => ({
            drawingId: a.drawingId,
            settlementId: settlement.id,
            amount: a.amount,
          })),
        });
      }

      const hydrated = await tx.partySettlement.findUnique({
        where: { id: settlement.id },
        include: { applications: true, safe: true },
      });
      return { ...hydrated, warnings };
    });
  }

  /**
   * Reverses a settlement's withdrawal applications when its net-cash
   * Transaction is voided — deleting the WithdrawalApplication rows alone
   * restores every affected drawing's remaining amount, since outstanding
   * is always derived live from this table (no running total to adjust).
   * Safe no-op if the voided transaction wasn't a settlement payout.
   */
  async unapplySettlementForTransaction(tx: Tx, transactionId: string) {
    const settlement = await tx.partySettlement.findFirst({ where: { transactionId } });
    if (!settlement) return;
    await tx.withdrawalApplication.deleteMany({ where: { settlementId: settlement.id } });
    await tx.partySettlement.update({ where: { id: settlement.id }, data: { status: 'VOIDED' } });
  }

  /**
   * One-query-batch outstanding-withdrawal total per party, for the
   * مسحوبات list page — replaces its former per-party N+1 "last drawing"
   * fetch with a single real figure (outstanding, not just "most recent").
   */
  async getOutstandingSummary(partyType?: string) {
    const parties = await this.prisma.party.findMany({
      where: { active: true, ...(partyType ? { partyType } : {}) },
      select: { id: true },
    });
    const partyIds = parties.map((p) => p.id);
    if (!partyIds.length) return [];

    const drawings = await this.prisma.partyDrawing.findMany({
      where: { partyId: { in: partyIds }, cancelled: false },
      select: { id: true, partyId: true, amount: true, date: true },
    });
    const drawingIds = drawings.map((d) => d.id);
    const applicationSums = drawingIds.length
      ? await this.prisma.withdrawalApplication.groupBy({
          by: ['drawingId'],
          where: { drawingId: { in: drawingIds } },
          _sum: { amount: true },
        })
      : [];
    const appliedByDrawing = new Map(applicationSums.map((a) => [a.drawingId, Number(a._sum.amount ?? 0)]));

    const byParty = new Map<string, { outstandingTotal: number; count: number; lastDate: Date | null }>();
    for (const d of drawings) {
      const remaining = Math.max(0, Number(d.amount) - (appliedByDrawing.get(d.id) ?? 0));
      if (remaining <= 0) continue;
      const entry = byParty.get(d.partyId) ?? { outstandingTotal: 0, count: 0, lastDate: null };
      entry.outstandingTotal += remaining;
      entry.count += 1;
      if (!entry.lastDate || d.date > entry.lastDate) entry.lastDate = d.date;
      byParty.set(d.partyId, entry);
    }

    return [...byParty.entries()].map(([partyId, v]) => ({
      partyId,
      outstandingTotal: v.outstandingTotal,
      count: v.count,
      lastDate: v.lastDate,
    }));
  }

  /**
   * Same shape as getOutstandingSummary() above, but for آجل (PartyDeferred)
   * instead of مسحوبات — simpler, since PartyDeferred.remainingAmount is
   * already the live outstanding figure (no WithdrawalApplication join
   * needed, unlike drawings).
   */
  async getOutstandingDeferredSummary(partyType?: string) {
    const parties = await this.prisma.party.findMany({
      where: { active: true, ...(partyType ? { partyType } : {}) },
      select: { id: true },
    });
    const partyIds = parties.map((p) => p.id);
    if (!partyIds.length) return [];

    const deferred = await this.prisma.partyDeferred.findMany({
      where: { partyId: { in: partyIds }, remainingAmount: { gt: 0 } },
      select: { partyId: true, remainingAmount: true, createdAt: true },
    });

    const byParty = new Map<string, { outstandingTotal: number; count: number; lastDate: Date | null }>();
    for (const d of deferred) {
      const entry = byParty.get(d.partyId) ?? { outstandingTotal: 0, count: 0, lastDate: null };
      entry.outstandingTotal += Number(d.remainingAmount);
      entry.count += 1;
      if (!entry.lastDate || d.createdAt > entry.lastDate) entry.lastDate = d.createdAt;
      byParty.set(d.partyId, entry);
    }

    return [...byParty.entries()].map(([partyId, v]) => ({
      partyId,
      outstandingTotal: v.outstandingTotal,
      count: v.count,
      lastDate: v.lastDate,
    }));
  }
}
