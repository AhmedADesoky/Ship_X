import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SafesService } from '../safes/safes.service';
import { CreateCourierDto } from './dto/create-courier.dto';
import { UpdateCourierDto } from './dto/update-courier.dto';
import { CreateSheetCollectionDto } from './dto/create-sheet-collection.dto';
import { CreateAdvanceDto } from './dto/create-advance.dto';
import { CreateRepaymentDto } from './dto/create-repayment.dto';

/**
 * مناديب القاهرة والجيزة (Cairo & Giza Couriers). Deliberately its own
 * module, not folded into PartiesService — Courier is not a Party (see the
 * schema comment above the Courier model for why reusing partyType='AGENT'
 * would have been wrong). Every money-moving method here is self-contained
 * (own $transaction, own balance check, own tx.transaction.create) rather
 * than delegating into TransactionsService, mirroring exactly how
 * PartiesService.createDrawing()/createDeferredPayment() already work.
 *
 * HARD BUSINESS RULE: sheet collections and advances are two completely
 * independent ledgers. Never compute one minus the other, anywhere, for
 * any reason — see summary() below.
 */
@Injectable()
export class CouriersService {
  constructor(
    private prisma: PrismaService,
    private safes: SafesService,
  ) {}

  private async findCategoryIdBySystemKey(systemKey: string): Promise<string | undefined> {
    const category = await this.prisma.category.findUnique({ where: { systemKey } });
    return category?.id;
  }

  findAll(q?: string, status?: string) {
    return this.prisma.courier.findMany({
      where: {
        // Defaults to active-only, matching PartiesService.findAll() — a
        // soft-deleted courier never lingers in the list unless the
        // caller explicitly asks to see inactive ones.
        active: status === 'inactive' ? false : true,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const courier = await this.prisma.courier.findUnique({ where: { id } });
    if (!courier) throw new NotFoundException('المندوب غير موجود');
    return courier;
  }

  async create(dto: CreateCourierDto) {
    const existing = await this.prisma.courier.findUnique({ where: { name: dto.name.trim() } });
    if (existing) throw new ConflictException('اسم المندوب موجود بالفعل');
    return this.prisma.courier.create({
      data: {
        name: dto.name.trim(),
        phone: dto.phone?.trim(),
        notes: dto.notes?.trim(),
        active: dto.active ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateCourierDto) {
    await this.findOne(id);
    return this.prisma.courier.update({ where: { id }, data: dto });
  }

  /**
   * Soft-delete, matching PartiesService.remove() exactly — a "deleted"
   * courier is deactivated, never hard-removed, since it has FK history
   * (sheet collections, advances) that must survive for audit/reporting.
   */
  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.courier.update({ where: { id }, data: { active: false } });
  }

  // ---- تقفيلات الشيتات (sheet collections) ----

  listSheetCollections(courierId: string) {
    return this.prisma.courierSheetCollection.findMany({
      where: { courierId },
      include: { safe: true },
      orderBy: { date: 'desc' },
    });
  }

  /**
   * Records the ONE actual amount the company received after manually
   * reviewing a courier's closed delivery sheet — never calculated by
   * this system. courierId is genuinely optional: a null value represents
   * a historical/opening collection pre-dating this system, never forced
   * onto a specific courier.
   */
  async createSheetCollection(dto: CreateSheetCollectionDto, createdById: string | undefined) {
    if (dto.courierId) await this.findOne(dto.courierId);
    const categoryId = await this.findCategoryIdBySystemKey('COURIER_SHEET_COLLECTION');

    return this.prisma.$transaction(async (tx) => {
      const safe = await tx.safe.findUnique({ where: { id: dto.safeId } });
      if (!safe) throw new NotFoundException('الحساب غير موجود');

      const transaction = await tx.transaction.create({
        data: {
          safeId: dto.safeId,
          kind: 'IN',
          amount: dto.amount,
          categoryId,
          description: dto.note ?? 'تحصيل شيت مناديب',
          createdById,
          createdAt: dto.date ? new Date(dto.date) : undefined,
        },
      });

      return tx.courierSheetCollection.create({
        data: {
          courierId: dto.courierId ?? null,
          safeId: dto.safeId,
          amount: dto.amount,
          note: dto.note,
          transactionId: transaction.id,
          createdById,
          date: dto.date ? new Date(dto.date) : undefined,
          source: dto.source ?? 'COURIER_PAGE',
        },
        include: { safe: true, courier: true },
      });
    });
  }

  /**
   * تقفيلات الشيتات غير المرتبطة بمندوب — every CourierSheetCollection row
   * with `courierId: null` (Phase 35). These are invisible anywhere else
   * in the Couriers module (every other read method filters on a specific
   * `courierId`), so without this list — and the assignSheetCollection()
   * method below — a historical/opening collection recorded as unassigned
   * (deliberately, via "تحصيل تاريخي") had no way to ever be found or
   * later attached to the right courier once that became known.
   */
  listUnassignedSheetCollections() {
    return this.prisma.courierSheetCollection.findMany({
      where: { courierId: null },
      include: { safe: true },
      orderBy: { date: 'desc' },
    });
  }

  /**
   * Attaches an existing (normally unassigned) sheet collection to a real
   * courier after the fact — the backfill counterpart to the fix above.
   * Does not touch the underlying Transaction (its categoryId/amount/safe
   * are already correct; only the courier link was ever missing), so this
   * is a pure metadata correction, not a new money movement.
   */
  async assignSheetCollection(collectionId: string, courierId: string) {
    await this.findOne(courierId);
    const collection = await this.prisma.courierSheetCollection.findUnique({ where: { id: collectionId } });
    if (!collection) throw new NotFoundException('تقفيلة الشيت غير موجودة');
    return this.prisma.courierSheetCollection.update({
      where: { id: collectionId },
      data: { courierId },
      include: { safe: true, courier: true },
    });
  }

  // ---- السلف (advances) ----

  listAdvances(courierId: string) {
    return this.prisma.courierAdvance.findMany({
      where: { courierId },
      include: { safe: true, repayments: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Gives a courier a cash advance — real money leaving the company
   * immediately (OUT transaction), not a promise. Multiple concurrent
   * open advances per courier are allowed (confirmed decision, matching
   * how مسحوبات already allows multiple partial draws in this system) —
   * no "must fully repay before a new one" guard here.
   */
  async createAdvance(courierId: string, dto: CreateAdvanceDto, createdById: string | undefined) {
    await this.findOne(courierId);
    const categoryId = await this.findCategoryIdBySystemKey('COURIER_ADVANCE');

    return this.prisma.$transaction(async (tx) => {
      const safe = await tx.safe.findUnique({ where: { id: dto.safeId } });
      if (!safe) throw new NotFoundException('الحساب غير موجود');

      await this.safes.assertSufficientBalance(dto.safeId, dto.amount, tx as any);

      const transaction = await tx.transaction.create({
        data: {
          safeId: dto.safeId,
          kind: 'OUT',
          amount: dto.amount,
          categoryId,
          description: dto.note ?? 'سلفة مندوب',
          createdById,
        },
      });

      return tx.courierAdvance.create({
        data: {
          courierId,
          safeId: dto.safeId,
          originalAmount: dto.amount,
          remainingAmount: dto.amount,
          transactionId: transaction.id,
          note: dto.note,
          status: 'OPEN',
          createdById,
        },
        include: { safe: true },
      });
    });
  }

  /**
   * Records a courier voluntarily repaying part or all of an outstanding
   * advance — a completely independent transaction from any سيط
   * collection. NEVER accept or compute a "sheet amount minus advance"
   * value anywhere in this method or any caller of it.
   */
  async createRepayment(courierId: string, advanceId: string, dto: CreateRepaymentDto, createdById: string | undefined) {
    const categoryId = await this.findCategoryIdBySystemKey('COURIER_ADVANCE_REPAYMENT');

    return this.prisma.$transaction(async (tx) => {
      const advance = await tx.courierAdvance.findUnique({ where: { id: advanceId } });
      if (!advance || advance.courierId !== courierId) {
        throw new NotFoundException('السلفة غير موجودة لهذا المندوب');
      }
      if (!dto.amount || dto.amount <= 0) {
        throw new BadRequestException('مبلغ السداد يجب أن يكون أكبر من صفر');
      }
      const remaining = Number(advance.remainingAmount);
      if (dto.amount > remaining + 0.005) {
        throw new BadRequestException(`مبلغ السداد (${dto.amount}) يتجاوز المتبقي من السلفة (${remaining})`);
      }

      const safe = await tx.safe.findUnique({ where: { id: dto.safeId } });
      if (!safe) throw new NotFoundException('الحساب غير موجود');

      const transaction = await tx.transaction.create({
        data: {
          safeId: dto.safeId,
          kind: 'IN',
          amount: dto.amount,
          categoryId,
          description: dto.note ?? 'توريد سلفة مندوب',
          createdById,
        },
      });

      const repayment = await tx.courierAdvanceRepayment.create({
        data: {
          advanceId,
          safeId: dto.safeId,
          amount: dto.amount,
          transactionId: transaction.id,
          createdById,
        },
      });

      const newRemaining = remaining - dto.amount;
      const updatedAdvance = await tx.courierAdvance.update({
        where: { id: advanceId },
        data: {
          remainingAmount: newRemaining,
          status: newRemaining <= 0.005 ? 'FULLY_REPAID' : 'PARTIALLY_REPAID',
        },
      });

      return { repayment, advance: updatedAdvance };
    });
  }

  // ---- ملخص والكشف (summary & statement) ----

  /**
   * HARD BUSINESS RULE: sheetCollectionsTotal and advances/outstanding are
   * DIFFERENT LEDGERS. Do NOT add, subtract, or derive one from the other
   * anywhere below, even for a "nice to have" combined balance.
   */
  async summary(courierId: string) {
    const [sheetAgg, advanceAgg, outstandingAgg] = await Promise.all([
      this.prisma.courierSheetCollection.aggregate({
        where: { courierId },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.courierAdvance.aggregate({
        where: { courierId },
        _sum: { originalAmount: true },
      }),
      this.prisma.courierAdvance.aggregate({
        where: { courierId, remainingAmount: { gt: 0 } },
        _sum: { remainingAmount: true },
      }),
    ]);

    // DO NOT: return { net: sheetCollectionsTotal - outstandingAdvances } — forbidden by spec.
    return {
      sheetCollectionsTotal: Number(sheetAgg._sum.amount ?? 0),
      sheetCollectionsCount: sheetAgg._count,
      advancesTotal: Number(advanceAgg._sum.originalAmount ?? 0),
      outstandingAdvances: Number(outstandingAgg._sum.remainingAmount ?? 0),
    };
  }

  /**
   * Unified chronological feed of the 3 independent event types. Each
   * event only ever carries its own amount/direction — no cumulative
   * "balance after this event" column is computed across mixed types,
   * since that would imply a relationship between sheets and advances
   * that must not exist.
   */
  async statement(courierId: string, start?: string, end?: string) {
    const dateFilter: any = {};
    if (start || end) {
      dateFilter.gte = start ? new Date(start) : undefined;
      dateFilter.lte = end ? new Date(end) : undefined;
    }
    const hasDateFilter = start || end;

    const [sheets, advances, repayments] = await Promise.all([
      this.prisma.courierSheetCollection.findMany({
        where: { courierId, ...(hasDateFilter ? { date: dateFilter } : {}) },
        include: { safe: true },
      }),
      this.prisma.courierAdvance.findMany({
        where: { courierId, ...(hasDateFilter ? { createdAt: dateFilter } : {}) },
        include: { safe: true },
      }),
      this.prisma.courierAdvanceRepayment.findMany({
        where: { advance: { courierId }, ...(hasDateFilter ? { date: dateFilter } : {}) },
        include: { safe: true, advance: true },
      }),
    ]);

    const events = [
      ...sheets.map((s) => ({
        type: 'SHEET_COLLECTION' as const,
        date: s.date,
        amount: Number(s.amount),
        direction: 'IN' as const,
        safe: s.safe,
        note: s.note,
        id: s.id,
      })),
      ...advances.map((a) => ({
        type: 'ADVANCE' as const,
        date: a.createdAt,
        amount: Number(a.originalAmount),
        direction: 'OUT' as const,
        safe: a.safe,
        note: a.note,
        id: a.id,
        // How much of THIS specific advance is still unpaid, right now —
        // not a point-in-time-at-creation figure, same "current state"
        // convention used everywhere else outstanding is shown in this app.
        remaining: Number(a.remainingAmount),
        settled: Number(a.remainingAmount) <= 0,
      })),
      ...repayments.map((r) => ({
        type: 'ADVANCE_REPAYMENT' as const,
        date: r.date,
        amount: Number(r.amount),
        direction: 'IN' as const,
        safe: r.safe,
        note: null as string | null,
        id: r.id,
        // The parent advance's current remaining balance after whatever
        // repayments have been made against it so far (not just this one).
        remaining: Number(r.advance.remainingAmount),
        settled: Number(r.advance.remainingAmount) <= 0,
      })),
    ];

    return events.sort((a, b) => +new Date(b.date) - +new Date(a.date));
  }

  /**
   * Batch outstanding-summary for the list page — one groupBy per metric
   * across ALL couriers, avoiding an N+1 per-courier fetch.
   */
  async getOutstandingSummary() {
    const [sheetTotals, advanceTotals, outstandingTotals] = await Promise.all([
      this.prisma.courierSheetCollection.groupBy({
        by: ['courierId'],
        where: { courierId: { not: null } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.courierAdvance.groupBy({
        by: ['courierId'],
        _sum: { originalAmount: true },
      }),
      this.prisma.courierAdvance.groupBy({
        by: ['courierId'],
        where: { remainingAmount: { gt: 0 } },
        _sum: { remainingAmount: true },
      }),
    ]);

    const sheetByC = new Map(sheetTotals.map((s) => [s.courierId, { total: Number(s._sum.amount ?? 0), count: s._count }]));
    const advanceByC = new Map(advanceTotals.map((a) => [a.courierId, Number(a._sum.originalAmount ?? 0)]));
    const outstandingByC = new Map(outstandingTotals.map((o) => [o.courierId, Number(o._sum.remainingAmount ?? 0)]));

    const courierIds = new Set([...sheetByC.keys(), ...advanceByC.keys(), ...outstandingByC.keys()].filter(Boolean) as string[]);

    return [...courierIds].map((courierId) => ({
      courierId,
      sheetCollectionsTotal: sheetByC.get(courierId)?.total ?? 0,
      sheetCollectionsCount: sheetByC.get(courierId)?.count ?? 0,
      advancesTotal: advanceByC.get(courierId) ?? 0,
      outstandingAdvances: outstandingByC.get(courierId) ?? 0,
    }));
  }
}
