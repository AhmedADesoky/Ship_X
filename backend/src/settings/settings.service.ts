import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SYSTEM_CATEGORIES } from '../common/system-categories';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async getAll(): Promise<Record<string, string>> {
    const rows = await this.prisma.appSetting.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async update(payload: Record<string, string>) {
    await this.prisma.$transaction(
      Object.entries(payload).map(([key, value]) =>
        this.prisma.appSetting.upsert({
          where: { key },
          update: { value: String(value) },
          create: { key, value: String(value) },
        }),
      ),
    );
    return this.getAll();
  }

  /**
   * Wipes all business data (transactions, safes, parties + their
   * drawings/deferred, categories, reconciliations, import batches, audit
   * logs, pending actions) while leaving User/RolePermission untouched, so
   * no login is affected. Owner-only, gated by the `reset_system`
   * permission which no other role has by default. Requires the literal
   * confirmation phrase as a second guard against an accidental call.
   */
  async resetSystem(confirm: string) {
    if (confirm !== 'RESET') {
      throw new BadRequestException('Confirmation phrase does not match');
    }

    await this.prisma.$transaction([
      this.prisma.partyDeferredPayment.deleteMany(),
      this.prisma.partyDeferred.deleteMany(),
      this.prisma.partyDrawing.deleteMany(),
      // Also missing until now (Phase 24 incidental fix) — a reset
      // previously left orphaned settlement-ledger rows behind since
      // these two tables were added (Phase 22) after resetSystem() was
      // last touched.
      this.prisma.withdrawalApplication.deleteMany(),
      this.prisma.partySettlement.deleteMany(),
      this.prisma.courierAdvanceRepayment.deleteMany(),
      this.prisma.courierAdvance.deleteMany(),
      this.prisma.courierSheetCollection.deleteMany(),
      this.prisma.pendingAction.deleteMany(),
      this.prisma.auditLog.deleteMany(),
      this.prisma.transaction.deleteMany(),
      this.prisma.party.deleteMany(),
      this.prisma.courier.deleteMany(),
      this.prisma.reconciliation.deleteMany(),
      this.prisma.importBatch.deleteMany(),
      this.prisma.category.deleteMany(),
      // The fixed-role categories (وكلاء محافظات, رواسل, مسحوبات, إعادة
      // إدخال, و مناديب القاهرة والجيزة) must exist immediately after a
      // reset — nothing else reseeds them, and every agent/sender/drawing/
      // courier search-box + auto-settlement flow depends on their
      // systemKey being present.
      this.prisma.category.createMany({ data: SYSTEM_CATEGORIES }),
      this.prisma.safe.deleteMany(),
    ]);

    return { reset: true };
  }

  /**
   * Zeroes out the numbers for a fresh financial period without touching
   * any entity — Party/Category/Safe rows are all left exactly as they
   * are, only their transaction history and derived balances are wiped.
   * A lighter sibling of resetSystem(): same confirmation-phrase +
   * reset_system permission gate, but a different phrase so the two
   * destructive actions can never be triggered by the same typed word.
   */
  async clearNumbers(confirm: string) {
    if (confirm !== 'CLEAR') {
      throw new BadRequestException('Confirmation phrase does not match');
    }

    await this.prisma.$transaction([
      this.prisma.partyDeferredPayment.deleteMany(),
      this.prisma.partyDeferred.deleteMany(),
      this.prisma.partyDrawing.deleteMany(),
      // Also missing until now (Phase 24 incidental fix) — see the
      // matching comment in resetSystem() above.
      this.prisma.withdrawalApplication.deleteMany(),
      this.prisma.partySettlement.deleteMany(),
      // Ledger history only — Courier rows themselves are entities, kept
      // intact, exactly like Party is kept intact above.
      this.prisma.courierAdvanceRepayment.deleteMany(),
      this.prisma.courierAdvance.deleteMany(),
      this.prisma.courierSheetCollection.deleteMany(),
      this.prisma.pendingAction.deleteMany(),
      this.prisma.auditLog.deleteMany(),
      this.prisma.transaction.deleteMany(),
      this.prisma.reconciliation.deleteMany(),
      this.prisma.importBatch.deleteMany(),
      // Balances are opening_balance + SUM(transactions) (see
      // SafesService.getBalance()) — with every transaction gone, zeroing
      // opening_balance too makes the post-clear balance genuinely 0
      // rather than whatever it happened to be before.
      this.prisma.safe.updateMany({ data: { openingBalance: 0 } }),
    ]);

    return { cleared: true };
  }

  /**
   * A manual "export data" safety net for the Owner — nothing more than
   * implicit trust in Supabase's own backups exists today. Returns every
   * business table as plain JSON (not the User/RolePermission tables —
   * this is a data snapshot, not a credential export); the controller
   * streams it back as a downloadable .json file.
   */
  async exportData() {
    const [safes, categories, parties, transactions, drawings, deferred, deferredPayments, reconciliations, importBatches, settings] =
      await Promise.all([
        this.prisma.safe.findMany(),
        this.prisma.category.findMany(),
        this.prisma.party.findMany(),
        this.prisma.transaction.findMany(),
        this.prisma.partyDrawing.findMany(),
        this.prisma.partyDeferred.findMany(),
        this.prisma.partyDeferredPayment.findMany(),
        this.prisma.reconciliation.findMany(),
        this.prisma.importBatch.findMany(),
        this.prisma.appSetting.findMany(),
      ]);

    return {
      exportedAt: new Date().toISOString(),
      safes,
      categories,
      parties,
      transactions,
      partyDrawings: drawings,
      partyDeferred: deferred,
      partyDeferredPayments: deferredPayments,
      reconciliations,
      importBatches,
      settings,
    };
  }
}
