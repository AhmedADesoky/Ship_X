import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSafeDto } from './dto/create-safe.dto';
import { TransferDto } from './dto/transfer.dto';
import { AdjustBalanceDto } from './dto/adjust-balance.dto';
import { DepositDto } from './dto/deposit.dto';

@Injectable()
export class SafesService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.safe.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' } });
  }

  async findOne(id: string) {
    const safe = await this.prisma.safe.findUnique({ where: { id } });
    if (!safe) throw new NotFoundException('Safe not found');
    return safe;
  }

  create(dto: CreateSafeDto) {
    return this.prisma.safe.create({ data: dto });
  }

  /**
   * openingBalance + SUM(IN) - SUM(OUT) [+ TRANSFER legs] over POSTED
   * transactions only — VOIDED rows (and their reversal rows, which are
   * themselves POSTED but net out the original) must never be excluded
   * from the sum, only rows literally marked VOIDED are excluded, matching
   * the old app's `balance()` in app/main.py exactly.
   */
  async getBalance(safeId: string): Promise<number> {
    const safe = await this.prisma.safe.findUnique({ where: { id: safeId } });
    if (!safe) throw new NotFoundException('Safe not found');
    const delta = await this.sumSignedDelta({ safeId, status: 'POSTED' });
    return Number(safe.openingBalance) + delta;
  }

  /**
   * SUM(CASE WHEN kind='OUT' THEN -amount ELSE amount END) computed in
   * Postgres rather than fetching every matching row and reducing in JS —
   * the row-fetch approach doesn't scale once a safe/party has years of
   * transaction history. Same sign convention as the old JS loop (TRANSFER
   * legs are already signed at creation time, see transfer() below).
   */
  private async sumSignedDelta(
    where: { safeId?: string; status?: string },
    client: Pick<PrismaService, 'transaction'> = this.prisma,
  ): Promise<number> {
    // A single-column SUM can't express the kind-conditional sign, so two
    // aggregates (one per kind) are combined — still just 2 index-backed
    // queries per safe instead of 1 unbounded row fetch.
    const [inSum, outSum] = await Promise.all([
      client.transaction.aggregate({ where: { ...where, kind: { not: 'OUT' } }, _sum: { amount: true } }),
      client.transaction.aggregate({ where: { ...where, kind: 'OUT' }, _sum: { amount: true } }),
    ]);
    return Number(inSum._sum.amount ?? 0) - Number(outSum._sum.amount ?? 0);
  }

  /**
   * Guards the "balance can never go negative" rule shared by every
   * money-leaving flow (regular OUT transactions, transfers, void
   * reversals, Excel import) — computed against `client` so it sees
   * whatever's already been written earlier in the same $transaction
   * (e.g. prior rows in the same Excel import batch), not just what was
   * committed before the transaction started. `amount` is the amount
   * about to leave the safe (always positive); throws if the resulting
   * balance would drop below zero. A small epsilon absorbs Decimal
   * rounding, matching remove()'s existing zero-balance check below.
   */
  async assertSufficientBalance(
    safeId: string,
    amount: number,
    client: Pick<PrismaService, 'safe' | 'transaction'> = this.prisma,
  ): Promise<void> {
    const safe = await client.safe.findUnique({ where: { id: safeId } });
    if (!safe) throw new NotFoundException('Safe not found');
    const delta = await this.sumSignedDelta({ safeId, status: 'POSTED' }, client);
    const currentBalance = Number(safe.openingBalance) + delta;
    if (currentBalance - amount < -0.005) {
      throw new BadRequestException(
        `رصيد الخزنة "${safe.name}" غير كافٍ لإتمام هذه العملية (الرصيد الحالي: ${currentBalance.toFixed(2)})`,
      );
    }
  }

  async getBalances() {
    const safes = await this.findAll();
    if (safes.length === 0) return [];

    // One SQL groupBy for every safe's IN/OUT sums, instead of N sequential
    // getBalance() calls (the N+1 pattern this replaces).
    const grouped = await this.prisma.transaction.groupBy({
      by: ['safeId', 'kind'],
      where: { safeId: { in: safes.map((s) => s.id) }, status: 'POSTED' },
      _sum: { amount: true },
    });
    const deltaBySafe = new Map<string, number>();
    for (const row of grouped) {
      const amount = Number(row._sum.amount ?? 0);
      const prev = deltaBySafe.get(row.safeId) ?? 0;
      deltaBySafe.set(row.safeId, prev + (row.kind === 'OUT' ? -amount : amount));
    }
    return safes.map((safe) => ({
      ...safe,
      balance: Number(safe.openingBalance) + (deltaBySafe.get(safe.id) ?? 0),
    }));
  }

  /**
   * Moves money between two safes as two linked transaction legs (an OUT
   * from fromSafeId and an IN to toSafeId) committed atomically in one
   * Prisma $transaction, so the sum across all safes (total company
   * balance) is invariant by construction — either both legs commit or
   * neither does.
   */
  async transfer(dto: TransferDto, createdById: string | undefined) {
    if (dto.fromSafeId === dto.toSafeId) {
      throw new BadRequestException('fromSafeId and toSafeId must differ');
    }

    return this.prisma.$transaction(async (tx) => {
      const [fromSafe, toSafe] = await Promise.all([
        tx.safe.findUnique({ where: { id: dto.fromSafeId } }),
        tx.safe.findUnique({ where: { id: dto.toSafeId } }),
      ]);
      if (!fromSafe) throw new NotFoundException('fromSafeId safe not found');
      if (!toSafe) throw new NotFoundException('toSafeId safe not found');

      await this.assertSufficientBalance(dto.fromSafeId, dto.amount, tx as any);

      const outLeg = await tx.transaction.create({
        data: {
          safeId: dto.fromSafeId,
          kind: 'TRANSFER',
          // Stored negative so getBalance() subtracts it; the paired IN leg
          // below is stored positive. Sum of both legs across all safes is
          // always zero, so total company balance is unchanged.
          amount: -Math.abs(dto.amount),
          description: dto.description ?? `تحويل إلى ${toSafe.name}`,
          createdById,
        },
      });

      const inLeg = await tx.transaction.create({
        data: {
          safeId: dto.toSafeId,
          kind: 'TRANSFER',
          amount: dto.amount,
          description: dto.description ?? `تحويل من ${fromSafe.name}`,
          createdById,
          relatedTransactionId: outLeg.id,
        },
      });

      await tx.transaction.update({
        where: { id: outLeg.id },
        data: { relatedTransactionId: inLeg.id },
      });

      return { outLeg, inLeg };
    });
  }

  /**
   * Manually reconciles a safe's balance to `targetBalance` by creating a
   * single IN or OUT transaction for the difference. Uses the same
   * getBalance() logic as everywhere else so the delta is computed
   * consistently. A zero delta is a no-op (no transaction is created).
   */
  async adjustBalance(safeId: string, dto: AdjustBalanceDto, createdById: string | undefined) {
    if (dto.targetBalance < 0) {
      throw new BadRequestException('لا يمكن تعيين رصيد سالب للخزنة');
    }
    return this.prisma.$transaction(async (tx) => {
      const safe = await tx.safe.findUnique({ where: { id: safeId } });
      if (!safe) throw new NotFoundException('Safe not found');

      const currentBalance = Number(safe.openingBalance) + (await this.sumSignedDelta({ safeId, status: 'POSTED' }, tx as any));

      const delta = dto.targetBalance - currentBalance;

      if (delta === 0) {
        return { transaction: null, balance: currentBalance };
      }

      const description = dto.note
        ? `تسوية رصيد يدوي: ${dto.note}`
        : 'تسوية رصيد يدوي';

      const transaction = await tx.transaction.create({
        data: {
          safeId,
          kind: delta > 0 ? 'IN' : 'OUT',
          amount: Math.abs(delta),
          description,
          createdById,
        },
      });

      return { transaction, balance: dto.targetBalance };
    });
  }

  /**
   * Directly posts an IN transaction for `amount` — a plain manual deposit
   * (e.g. "found 500 EGP in the drawer"), distinct from adjustBalance()'s
   * "reconcile to this target total" flow. Doesn't read the current balance
   * at all, so there's no read-then-diff race with concurrent transactions.
   */
  async deposit(safeId: string, dto: DepositDto, createdById: string | undefined) {
    await this.findOne(safeId);
    const description = dto.note ? `إيداع يدوي: ${dto.note}` : 'إيداع يدوي';
    const transaction = await this.prisma.transaction.create({
      data: {
        safeId,
        kind: 'IN',
        amount: dto.amount,
        description,
        createdById,
      },
    });
    return { transaction, balance: await this.getBalance(safeId) };
  }

  /**
   * Soft-deletes a safe (sets active=false) — never a hard delete, since
   * past transactions/drawings/reconciliations reference it and must
   * survive for audit/reporting (they stay visible in history, the safe
   * just stops appearing in lists/pickers going forward). Refuses to delete
   * a safe that still has a nonzero balance, so money can't silently become
   * unaccounted for — transfer or adjust it to zero first. Gated at the
   * controller by the `delete_safes` permission, which only OWNER has by
   * default — anyone else needs an explicit per-user grant.
   */
  async remove(id: string) {
    const safe = await this.findOne(id);
    if (!safe.active) throw new NotFoundException('Safe not found');

    const balance = await this.getBalance(id);
    if (Math.abs(balance) > 0.005) {
      throw new ConflictException(
        'Cannot delete a safe with a nonzero balance — transfer or adjust it to zero first.',
      );
    }

    return this.prisma.safe.update({ where: { id }, data: { active: false } });
  }
}
