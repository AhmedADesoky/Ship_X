import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PartiesService } from '../parties/parties.service';
import { SafesService } from '../safes/safes.service';
import { validateTxRules } from './transaction-rules';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { QueryTransactionsDto } from './dto/query-transactions.dto';
import { CreateTransactionBatchDto } from './dto/create-transaction-batch.dto';

type Tx = Prisma.TransactionClient;

@Injectable()
export class TransactionsService {
  constructor(
    private prisma: PrismaService,
    private parties: PartiesService,
    private safes: SafesService,
  ) {}

  private async loadCategoryPartyAndCourier(categoryId?: string, partyId?: string, courierId?: string) {
    const [category, party, courier] = await Promise.all([
      categoryId ? this.prisma.category.findUnique({ where: { id: categoryId } }) : null,
      partyId ? this.prisma.party.findUnique({ where: { id: partyId } }) : null,
      courierId ? this.prisma.courier.findUnique({ where: { id: courierId } }) : null,
    ]);
    if (partyId && (!party || !party.active)) throw new BadRequestException('الجهة غير موجودة');
    if (courierId && (!courier || !courier.active)) throw new BadRequestException('المندوب غير موجود');
    return { category, party, courier };
  }

  async findAll(query: QueryTransactionsDto) {
    const where: any = { status: 'POSTED' };
    if (query.kind) where.kind = query.kind;
    if (query.safeId) where.safeId = query.safeId;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.partyId) where.partyId = query.partyId;
    if (query.start || query.end) {
      where.createdAt = {};
      if (query.start) where.createdAt.gte = new Date(query.start);
      if (query.end) where.createdAt.lte = new Date(query.end);
    }
    if (query.q) {
      where.OR = [
        { description: { contains: query.q, mode: 'insensitive' } },
        { referenceNo: { contains: query.q, mode: 'insensitive' } },
        { notes: { contains: query.q, mode: 'insensitive' } },
        { party: { name: { contains: query.q, mode: 'insensitive' } } },
        { category: { name: { contains: query.q, mode: 'insensitive' } } },
      ];
    }
    // page/pageSize (take/skip) is the preferred pagination path; `limit`
    // is kept for back-compat with callers that just want a capped list.
    const pageSize = Math.min(Number(query.pageSize) || Number(query.limit) || 50, 2000);
    const page = Math.max(Number(query.page) || 1, 1);
    return this.prisma.transaction.findMany({
      where,
      include: { safe: true, category: true, party: true, createdBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    });
  }

  async findOne(id: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id },
      include: { safe: true, category: true, party: true, createdBy: { select: { id: true, name: true } } },
    });
    if (!tx) throw new NotFoundException('العملية غير موجودة');
    return tx;
  }

  /**
   * The actual per-row creation logic, factored out of create() so
   * createBatch() can run it N times inside ONE outer $transaction instead
   * of duplicating this body — any row's failure then rolls back every
   * other row already written in that same batch, for free, via Prisma's
   * normal $transaction semantics.
   */
  private async createOneWithinTx(
    tx: Tx,
    dto: CreateTransactionDto,
    category: { systemKey?: string | null; partyType?: string | null; requiresCourier?: boolean | null } | null,
    createdById: string | undefined,
  ) {
    // Balance can never go negative — checked before the row exists so a
    // rejected expense never gets written at all.
    if (dto.kind === 'OUT') {
      await this.safes.assertSufficientBalance(dto.safeId, dto.amount, tx as any);
    }

    const transaction = await tx.transaction.create({
      data: {
        kind: dto.kind,
        amount: dto.amount,
        safeId: dto.safeId,
        categoryId: dto.categoryId,
        partyId: dto.partyId,
        courierId: dto.courierId,
        description: dto.description,
        referenceNo: dto.referenceNo,
        notes: dto.notes,
        createdById,
        createdAt: dto.date ? new Date(dto.date) : undefined,
      },
      include: { safe: true, category: true, party: true },
    });

    // Only the dedicated مسحوبات category is a real drawing — a رواسل (or
    // any other merchant-party) expense is a plain transaction that must
    // show up in فعلي's log but never get a PartyDrawing row, a spot on
    // the مسحوبات page, or a redeposit button. Scoped by systemKey (not
    // partyType) so it stays correct regardless of entry point.
    if (dto.kind === 'OUT' && dto.partyId && category?.systemKey === 'MERCHANT_DRAWING') {
      await this.parties.syncDrawingForTransaction(tx, transaction.id, {
        partyId: dto.partyId,
        safeId: dto.safeId,
        amount: dto.amount,
        note: dto.description,
      });
    }

    // Income recorded against an agent with an open آجل (deferred)
    // balance auto-settles against it (FIFO, oldest record first) —
    // the same "internal entry point does the same bookkeeping a
    // dedicated flow would" principle as the drawing sync above.
    if (dto.kind === 'IN' && dto.partyId && category?.partyType === 'AGENT') {
      await this.parties.syncDeferredPaymentForTransaction(tx, transaction.id, {
        partyId: dto.partyId,
        safeId: dto.safeId,
        amount: dto.amount,
        note: dto.description,
      });
    }

    return transaction;
  }

  /**
   * رواسل (MERCHANT_SENDER) expenses are allowed through this generic
   * endpoint like any other category UNLESS the party still has open
   * مسحوبات (drawings) to net — in that case the payout must go through
   * PartiesService.createSettlement() instead, which records gross/applied/
   * net and a real WithdrawalApplication ledger. Throwing a structured
   * ConflictException (nested under `message`, so HttpExceptionFilter's
   * existing pass-through logic carries it to the client unmodified) lets
   * the frontend detect this specific case and redirect to Settlement
   * rather than showing a generic error. Any other category (including
   * MERCHANT_DRAWING itself) is unaffected.
   */
  private async assertNoOpenDrawingsForSenderPayout(
    category: { systemKey?: string | null } | null,
    partyId: string | null | undefined,
  ) {
    if (category?.systemKey !== 'MERCHANT_SENDER' || !partyId) return;
    const openDrawings = await this.parties.getOutstandingDrawingsTotal(partyId);
    if (openDrawings > 0.005) {
      throw new ConflictException({
        message: { code: 'REQUIRES_SETTLEMENT', requiresSettlement: true, partyId, openDrawings },
      });
    }
  }

  // Unlike رواسل above, these 3 categories are NEVER valid through the
  // generic endpoint — مناديب القاهرة والجيزة sheet collections/advances/
  // repayments must go through the dedicated Couriers module, which
  // records a real CourierSheetCollection/CourierAdvance/
  // CourierAdvanceRepayment row alongside the Transaction. A plain
  // transaction under one of these would be invisible on that courier's
  // own page and never count toward their balance. The frontend already
  // redirects into the Couriers flow instead of letting these reach
  // submit; this is the server-side backstop so no caller can bypass it.
  private static readonly COURIER_LEDGER_SYSTEM_KEYS = new Set([
    'COURIER_SHEET_COLLECTION',
    'COURIER_ADVANCE',
    'COURIER_ADVANCE_REPAYMENT',
  ]);

  private assertNotCourierLedgerCategory(category: { systemKey?: string | null } | null) {
    if (category?.systemKey && TransactionsService.COURIER_LEDGER_SYSTEM_KEYS.has(category.systemKey)) {
      throw new BadRequestException('يجب تسجيل هذه العملية من صفحة المناديب');
    }
  }

  async create(dto: CreateTransactionDto, createdById: string | undefined) {
    const { category, party, courier } = await this.loadCategoryPartyAndCourier(
      dto.categoryId,
      dto.partyId,
      dto.courierId,
    );
    validateTxRules(dto.kind, category as any, party as any, courier as any);
    this.assertNotCourierLedgerCategory(category);
    await this.assertNoOpenDrawingsForSenderPayout(category, dto.partyId);

    const safe = await this.prisma.safe.findUnique({ where: { id: dto.safeId } });
    if (!safe) throw new BadRequestException('الحساب غير موجود');

    return this.prisma.$transaction(async (tx) => this.createOneWithinTx(tx, dto, category, createdById));
  }

  /**
   * طلب سريع (quick request): several IN/OUT rows sharing one optional
   * party, created atomically — any row's failure (category/party
   * mismatch, insufficient balance, unknown safe) rolls back the ENTIRE
   * batch via Prisma's own $transaction rollback, so nothing is ever
   * partially posted. All validation happens up front (every row) before
   * any row is written, so a late failure doesn't leave earlier rows'
   * side-effect queries (balance checks, etc.) half-run against rows that
   * get rolled back anyway — cheap to do, and gives a cleaner error for a
   * row near the end of a long batch.
   */
  async createBatch(dto: CreateTransactionBatchDto, createdById: string | undefined) {
    if (!dto.items?.length) {
      throw new BadRequestException('يجب إضافة عملية واحدة على الأقل');
    }

    const resolved = await Promise.all(
      dto.items.map(async (item) => {
        const { category, party, courier } = await this.loadCategoryPartyAndCourier(
          item.categoryId,
          dto.partyId,
          dto.courierId,
        );
        validateTxRules(item.kind, category as any, party as any, courier as any);
        this.assertNotCourierLedgerCategory(category);
        await this.assertNoOpenDrawingsForSenderPayout(category, dto.partyId);
        const safe = await this.prisma.safe.findUnique({ where: { id: item.safeId } });
        if (!safe) throw new BadRequestException('الحساب غير موجود');
        return { item, category };
      }),
    );

    return this.prisma.$transaction(async (tx) => {
      const created: Awaited<ReturnType<TransactionsService['createOneWithinTx']>>[] = [];
      for (const { item, category } of resolved) {
        const row = await this.createOneWithinTx(
          tx,
          {
            kind: item.kind,
            amount: item.amount,
            safeId: item.safeId,
            categoryId: item.categoryId,
            partyId: dto.partyId,
            courierId: dto.courierId,
            description: item.description,
            referenceNo: item.referenceNo,
          } as CreateTransactionDto,
          category,
          createdById,
        );
        created.push(row);
      }
      return created;
    });
  }

  async update(id: string, dto: UpdateTransactionDto) {
    const existing = await this.prisma.transaction.findUnique({ where: { id } });
    if (!existing || existing.status !== 'POSTED') {
      throw new NotFoundException('العملية غير موجودة أو ملغاة');
    }
    // kind is immutable — always re-validated against the ORIGINAL kind,
    // matching the old app's edit_transaction() which reuses old['kind'].
    const categoryId = dto.categoryId !== undefined ? dto.categoryId : existing.categoryId ?? undefined;
    const partyId = dto.partyId !== undefined ? dto.partyId : existing.partyId ?? undefined;
    const courierId = dto.courierId !== undefined ? dto.courierId : existing.courierId ?? undefined;
    const { category, party, courier } = await this.loadCategoryPartyAndCourier(
      categoryId ?? undefined,
      partyId ?? undefined,
      courierId ?? undefined,
    );
    validateTxRules(existing.kind as 'IN' | 'OUT', category as any, party as any, courier as any);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.transaction.update({
        where: { id },
        data: {
          amount: dto.amount ?? existing.amount,
          safeId: dto.safeId ?? existing.safeId,
          categoryId: categoryId ?? null,
          partyId: partyId ?? null,
          courierId: courierId ?? null,
          description: dto.description ?? existing.description,
          referenceNo: dto.referenceNo ?? existing.referenceNo,
          notes: dto.notes ?? existing.notes,
          createdAt: dto.date ? new Date(dto.date) : existing.createdAt,
        },
        include: { safe: true, category: true, party: true },
      });

      // Balance can never go negative — checked after the write (rather
      // than pre-computing a delta) since the edit may have changed the
      // amount, the safe, or both; assertSufficientBalance(..., 0, tx)
      // simply confirms the resulting balance, which already reflects this
      // update inside the same tx, isn't negative. Throwing here rolls
      // back the update along with everything else in this $transaction.
      if (updated.kind === 'OUT') {
        await this.safes.assertSufficientBalance(updated.safeId, 0, tx as any);
      }

      // Keep the linked PartyDrawing in sync with the edited transaction:
      // create/update it if the transaction still (or newly) qualifies as a
      // مسحوبات-category OUT with a party, or remove it if the edit made it
      // no longer qualify (category changed away from مسحوبات, or party
      // removed).
      const qualifiesAsDrawing =
        updated.kind === 'OUT' && !!updated.partyId && category?.systemKey === 'MERCHANT_DRAWING';
      await this.parties.syncDrawingForTransaction(
        tx,
        updated.id,
        qualifiesAsDrawing
          ? {
              partyId: updated.partyId as string,
              safeId: updated.safeId,
              amount: Number(updated.amount),
              note: updated.description,
            }
          : null,
      );

      const qualifiesForDeferred = updated.kind === 'IN' && !!updated.partyId && category?.partyType === 'AGENT';
      await this.parties.syncDeferredPaymentForTransaction(
        tx,
        updated.id,
        qualifiesForDeferred
          ? {
              partyId: updated.partyId as string,
              safeId: updated.safeId,
              amount: Number(updated.amount),
              note: updated.description,
            }
          : null,
      );

      return updated;
    });
  }

  /**
   * Void/reverse, ported exactly from the old app's void_transaction()
   * (app/main.py): the original row is marked VOIDED (excluded from
   * balance sums, since getBalance() only sums status='POSTED' rows), and
   * a new opposite-kind POSTED transaction is inserted referencing it via
   * relatedTransactionId, with its description prefixed "عكس: ". Note this
   * is a faithful port of the old app's actual arithmetic, not a "return to
   * the pre-transaction balance" operation: voiding an IN of amount A moves
   * the safe's POSTED-only balance by -A relative to before the original
   * ever posted (original's +A is fully excluded, and the reversal OUT
   * additionally subtracts A) — see transactions.service.spec.ts.
   */
  async void(id: string) {
    const original = await this.prisma.transaction.findUnique({ where: { id } });
    if (!original || original.status !== 'POSTED') {
      throw new NotFoundException('العملية غير موجودة');
    }
    const reversalKind = original.kind === 'IN' ? 'OUT' : 'IN';

    return this.prisma.$transaction(async (tx) => {
      const reversal = await tx.transaction.create({
        data: {
          kind: reversalKind as any,
          amount: original.amount,
          safeId: original.safeId,
          categoryId: original.categoryId,
          partyId: original.partyId,
          courierId: original.courierId,
          description: `عكس: ${original.description || 'عملية'}`,
          referenceNo: original.referenceNo,
          notes: 'عملية عكسية',
          relatedTransactionId: original.id,
        },
      });
      await tx.transaction.update({ where: { id: original.id }, data: { status: 'VOIDED' } });
      // Balance can never go negative — voiding an old IN transaction
      // posts an OUT reversal, which can push the safe negative just like
      // any other expense. Checked after both writes above, same
      // post-write pattern as update().
      if (reversalKind === 'OUT') {
        await this.safes.assertSufficientBalance(original.safeId, 0, tx as any);
      }
      // A voided transaction is excluded from balance sums going forward, so
      // any PartyDrawing it created must be removed too — otherwise
      // totalDrawings/netOutstanding would keep counting a reversed expense.
      await this.parties.syncDrawingForTransaction(tx, original.id, null);
      // Same reasoning for a voided deferred-settling transaction — restore
      // whatever it applied against the party's آجل balance. A safe no-op
      // if the original wasn't linked to any deferred payment.
      await this.parties.syncDeferredPaymentForTransaction(tx, original.id, null);
      // And if this was a سرواسل settlement's net-cash transaction, reverse
      // its WithdrawalApplication rows — every drawing it applied against
      // becomes outstanding again. Safe no-op otherwise.
      await this.parties.unapplySettlementForTransaction(tx, original.id);
      return { reversalId: reversal.id };
    });
  }
}
