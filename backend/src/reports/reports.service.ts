import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { getCurrentCairoWeekStartUtc, toCairoDateString } from '../common/cairo-time';

// The literal token string @nestjs/cache-manager registers CacheModule's
// provider under — used directly (not imported from the package) because
// @nestjs/cache-manager ships ESM-only and importing it here drags that
// into ts-jest's CJS transform, which chokes on it in tests.
const CACHE_MANAGER = 'CACHE_MANAGER';

const MONTHS_BACK = 12;
const SAFE_TREND_DAYS = 30;
const DASHBOARD_CACHE_KEY = 'reports:dashboard';
const DASHBOARD_CACHE_TTL_MS = 20_000;

// All date-bucket keys are derived in UTC (both for stored timestamps via
// toISOString(), and for synthetic calendar boundaries via Date.UTC()) so
// they line up regardless of the server's local timezone — mixing
// local-midnight Date construction with toISOString() shifts the date by
// a day (or month, at a month boundary) whenever the server isn't in UTC.
function monthKey(d: Date) {
  return d.toISOString().slice(0, 7);
}

@Injectable()
export class ReportsService {
  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  /**
   * Dashboard aggregate: current per-safe + total balances, recent
   * transactions, a day-bucketed this-week (Saturday-to-Friday, Cairo
   * local time) IN/OUT series, and a batch of
   * additional breakdowns/trends for the dashboard's chart set (category
   * split, party-type split, monthly cash flow, outstanding deferred
   * trend, reconciliation drift, per-safe balance trend, pending-approval
   * count). Reuses the same balance math as SafesService.getBalance rather
   * than duplicating it against a stored column, so it can never drift
   * from the safes list.
   *
   * Cached for a short TTL (see DASHBOARD_CACHE_TTL_MS) — this method scans
   * every POSTED transaction and is called on every dashboard page load;
   * a 20s-stale dashboard is an acceptable tradeoff for a finance app that
   * already labels its figures with an "as of" timestamp, versus rescanning
   * the full transaction table on every request. Uses Redis when
   * REDIS_URL is configured (see AppCacheModule) so this stays correct
   * across multiple backend instances, not just single-process memory.
   */
  async getDashboard() {
    const cached = await this.cache.get(DASHBOARD_CACHE_KEY);
    if (cached) return cached;

    const result = await this.computeDashboard();
    await this.cache.set(DASHBOARD_CACHE_KEY, result, DASHBOARD_CACHE_TTL_MS);
    return result;
  }

  private async computeDashboard() {
    const [safes, recentTransactions, pendingCount] = await Promise.all([
      this.prisma.safe.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.transaction.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          safe: { select: { name: true } },
          party: { select: { name: true } },
          createdBy: { select: { name: true } },
        },
      }),
      this.prisma.pendingAction.count({ where: { status: 'PENDING' } }),
    ]);

    const allTransactions = await this.prisma.transaction.findMany({
      where: { status: 'POSTED' },
      select: {
        safeId: true,
        kind: true,
        amount: true,
        createdAt: true,
        partyId: true,
        party: { select: { name: true, partyType: true } },
        categoryId: true,
        category: { select: { name: true, kind: true, partyType: true, systemKey: true } },
      },
    });

    const balanceBySafe = new Map<string, number>();
    for (const safe of safes) balanceBySafe.set(safe.id, Number(safe.openingBalance));
    for (const row of allTransactions) {
      const amount = Number(row.amount);
      const delta = row.kind === 'OUT' ? -amount : amount;
      balanceBySafe.set(row.safeId, (balanceBySafe.get(row.safeId) ?? 0) + delta);
    }

    const safeBalances = safes.map((safe) => ({ ...safe, balance: balanceBySafe.get(safe.id) ?? 0 }));
    const totalBalance = safeBalances.reduce((sum, s) => sum + s.balance, 0);

    // Used below by the unrelated monthly-trend/reconciliation-window
    // logic further down this method (still UTC-anchored, per the file's
    // general convention — only the weekly series right below is
    // Cairo-anchored).
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    // This week's (Saturday-to-Friday, Cairo-local) IN/OUT series, oldest
    // first — resets automatically the instant Cairo's clock crosses into
    // a new Saturday, since this is recomputed fresh on every cache-miss
    // (no cron/scheduled job needed). Bucketed by each transaction's Cairo
    // calendar day (not raw UTC day), so one made shortly before/after UTC
    // midnight still lands on the day it clearly belongs to in Cairo.
    const days: { date: string; in: number; out: number }[] = [];
    const weekStart = getCurrentCairoWeekStartUtc();
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart.getTime() + i * 24 * 60 * 60 * 1000);
      days.push({ date: toCairoDateString(d), in: 0, out: 0 });
    }
    const dayIndex = new Map(days.map((d, i) => [d.date, i]));
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    for (const row of allTransactions) {
      if (row.createdAt < weekStart || row.createdAt >= weekEnd) continue;
      const key = toCairoDateString(row.createdAt);
      const idx = dayIndex.get(key);
      if (idx === undefined) continue;
      const amount = Math.abs(Number(row.amount));
      if (row.kind === 'OUT') days[idx].out += amount;
      else days[idx].in += amount;
    }

    // Top parties by net OUT activity — scoped by category systemKey (not
    // partyType) so مسحوبات and رواسل are unambiguous even if a user later
    // adds a second OUT+MERCHANT category, and so this never has to guess
    // at netting the way the old redeposit-category subtraction did
    // (Transaction.amount under MERCHANT_SENDER is already net cash paid
    // since Phase 22 — no further subtraction needed here).
    const byParty = new Map<string, { name: string; total: number }>();
    for (const row of allTransactions) {
      if (!row.partyId || row.kind !== 'OUT') continue;
      const existing = byParty.get(row.partyId) ?? { name: row.party?.name ?? 'Unknown', total: 0 };
      existing.total += Math.abs(Number(row.amount));
      byParty.set(row.partyId, existing);
    }
    const clientBreakdown = [...byParty.values()]
      .filter((p) => p.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    // Withdrawals (مسحوبات) vs sender settlements (رواسل) kept as two
    // explicit, unambiguous totals instead of blended into one figure —
    // settlementNetTotal is already net cash paid by construction, so
    // summing it never double-counts a withdrawal applied against it.
    let drawingsTotal = 0;
    let settlementNetTotal = 0;
    for (const row of allTransactions) {
      if (row.kind !== 'OUT' || !row.category?.systemKey) continue;
      if (row.category.systemKey === 'MERCHANT_DRAWING') drawingsTotal += Math.abs(Number(row.amount));
      else if (row.category.systemKey === 'MERCHANT_SENDER') settlementNetTotal += Math.abs(Number(row.amount));
    }

    // Income/expense split by category (all-time over POSTED transactions).
    const byCategory = new Map<string, { name: string; kind: string; total: number }>();
    for (const row of allTransactions) {
      if (row.kind === 'TRANSFER') continue;
      const key = `${row.kind}:${row.category?.name ?? ''}`;
      const entry = byCategory.get(key) ?? { name: row.category?.name ?? 'بدون بند', kind: row.kind, total: 0 };
      entry.total += Math.abs(Number(row.amount));
      byCategory.set(key, entry);
    }
    const categoryBreakdown = [...byCategory.values()].sort((a, b) => b.total - a.total).slice(0, 8);

    // Activity split by party type (AGENT vs MERCHANT vs any custom type).
    const byPartyType = new Map<string, number>();
    for (const row of allTransactions) {
      if (!row.party?.partyType) continue;
      byPartyType.set(row.party.partyType, (byPartyType.get(row.party.partyType) ?? 0) + Math.abs(Number(row.amount)));
    }
    const partyTypeBreakdown = [...byPartyType.entries()].map(([type, total]) => ({ type, total }));

    // Monthly net cash flow, last 12 months (including the current one),
    // oldest first.
    const months: { month: string; in: number; out: number }[] = [];
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (MONTHS_BACK - 1), 1));
    for (let i = 0; i < MONTHS_BACK; i++) {
      const d = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + i, 1));
      months.push({ month: monthKey(d), in: 0, out: 0 });
    }
    const monthIndex = new Map(months.map((m, i) => [m.month, i]));
    for (const row of allTransactions) {
      if (row.kind === 'TRANSFER') continue;
      const idx = monthIndex.get(monthKey(row.createdAt));
      if (idx === undefined) continue;
      const amount = Math.abs(Number(row.amount));
      if (row.kind === 'OUT') months[idx].out += amount;
      else months[idx].in += amount;
    }
    const monthlySeries = months;

    // Outstanding آجل (deferred) balance trend: cumulative(originalAmount
    // opened) - cumulative(payments made), bucketed by month.
    const [deferredEntries, deferredPayments] = await Promise.all([
      this.prisma.partyDeferred.findMany({ select: { originalAmount: true, createdAt: true } }),
      this.prisma.partyDeferredPayment.findMany({ select: { amount: true, date: true } }),
    ]);
    const openedByMonth = new Map<string, number>();
    for (const d of deferredEntries) {
      const key = monthKey(d.createdAt);
      openedByMonth.set(key, (openedByMonth.get(key) ?? 0) + Number(d.originalAmount));
    }
    const paidByMonth = new Map<string, number>();
    for (const p of deferredPayments) {
      const key = monthKey(p.date);
      paidByMonth.set(key, (paidByMonth.get(key) ?? 0) + Number(p.amount));
    }
    let runningOutstanding = 0;
    const deferredTrend = months.map((m) => {
      runningOutstanding += (openedByMonth.get(m.month) ?? 0) - (paidByMonth.get(m.month) ?? 0);
      return { month: m.month, outstanding: runningOutstanding };
    });

    // Reconciliation drift: the last 20 reconciliations' difference, so a
    // recurring non-zero pattern is visible at a glance instead of buried
    // in the reconciliation history table.
    const reconciliations = await this.prisma.reconciliation.findMany({
      orderBy: { reconDate: 'desc' },
      take: 20,
      include: { safe: { select: { name: true } } },
    });
    const reconciliationDrift = reconciliations
      .reverse()
      .map((r) => ({
        date: r.reconDate.toISOString().slice(0, 10),
        safe: r.safe.name,
        difference: Number(r.difference),
      }));

    // Per-safe cumulative balance trend, last 30 days. Starts from each
    // safe's balance at the beginning of the window (openingBalance + all
    // transactions before it), then walks forward day by day.
    const windowStart = new Date(today);
    windowStart.setUTCDate(windowStart.getUTCDate() - (SAFE_TREND_DAYS - 1));
    const balanceAtWindowStart = new Map<string, number>();
    for (const safe of safes) balanceAtWindowStart.set(safe.id, Number(safe.openingBalance));
    for (const row of allTransactions) {
      if (row.createdAt >= windowStart) continue;
      const amount = Number(row.amount);
      const delta = row.kind === 'OUT' ? -amount : amount;
      balanceAtWindowStart.set(row.safeId, (balanceAtWindowStart.get(row.safeId) ?? 0) + delta);
    }
    const trendDays: string[] = [];
    for (let i = 0; i < SAFE_TREND_DAYS; i++) {
      const d = new Date(windowStart);
      d.setUTCDate(d.getUTCDate() + i);
      trendDays.push(d.toISOString().slice(0, 10));
    }
    const runningBySafe = new Map(safes.map((s) => [s.id, balanceAtWindowStart.get(s.id) ?? 0]));
    const deltaByDaySafe = new Map<string, number>();
    for (const row of allTransactions) {
      if (row.createdAt < windowStart) continue;
      const dateKey = row.createdAt.toISOString().slice(0, 10);
      const key = `${dateKey}:${row.safeId}`;
      const amount = Number(row.amount);
      const delta = row.kind === 'OUT' ? -amount : amount;
      deltaByDaySafe.set(key, (deltaByDaySafe.get(key) ?? 0) + delta);
    }
    // Keyed by safe id, not name — safe names aren't guaranteed unique
    // (e.g. two safes both called "خزنة الشركة"), and colliding object keys
    // would silently merge two safes' balances into one series.
    const safeBalanceTrend = trendDays.map((date) => {
      const point: Record<string, string | number> = { date };
      for (const safe of safes) {
        const key = `${date}:${safe.id}`;
        const next = (runningBySafe.get(safe.id) ?? 0) + (deltaByDaySafe.get(key) ?? 0);
        runningBySafe.set(safe.id, next);
        point[safe.id] = next;
      }
      return point;
    });

    // Outstanding withdrawals (مسحوبات) company-wide, plus settlement
    // totals — reuses the same live-derived-from-WithdrawalApplication
    // shape as PartiesService.getOutstandingDrawings(), just unscoped by
    // party. Kept as a separate query batch (not folded into allTransactions
    // above) since it needs the PartyDrawing/WithdrawalApplication tables
    // directly, not the Transaction rows.
    const [openDrawings, applicationSums, settlementTotals] = await Promise.all([
      this.prisma.partyDrawing.findMany({
        where: { cancelled: false },
        select: { id: true, partyId: true, amount: true },
      }),
      this.prisma.withdrawalApplication.groupBy({ by: ['drawingId'], _sum: { amount: true } }),
      this.prisma.partySettlement.aggregate({
        where: { status: 'POSTED' },
        _sum: { grossAmount: true, appliedAmount: true, netAmount: true },
        _count: true,
      }),
    ]);
    const appliedByDrawing = new Map(applicationSums.map((a) => [a.drawingId, Number(a._sum.amount ?? 0)]));
    const partiesWithOutstanding = new Set<string>();
    let totalOutstandingWithdrawals = 0;
    for (const d of openDrawings) {
      const remaining = Math.max(0, Number(d.amount) - (appliedByDrawing.get(d.id) ?? 0));
      if (remaining > 0) {
        totalOutstandingWithdrawals += remaining;
        partiesWithOutstanding.add(d.partyId);
      }
    }

    // مناديب القاهرة والجيزة (couriers) — three independent metrics by
    // hard business rule (see CouriersService.summary()'s own comment):
    // never sum/subtract across sheet collections and advances anywhere,
    // including here.
    const [courierSheetAgg, courierAdvanceAgg, courierOutstandingAgg] = await Promise.all([
      this.prisma.courierSheetCollection.aggregate({ _sum: { amount: true } }),
      this.prisma.courierAdvance.aggregate({ _sum: { originalAmount: true } }),
      this.prisma.courierAdvance.aggregate({
        where: { remainingAmount: { gt: 0 } },
        _sum: { remainingAmount: true },
      }),
    ]);
    const courierCollectionsTotal = Number(courierSheetAgg._sum.amount ?? 0);
    const courierAdvancesTotal = Number(courierAdvanceAgg._sum.originalAmount ?? 0);
    const courierOutstandingAdvances = Number(courierOutstandingAgg._sum.remainingAmount ?? 0);

    return {
      totalBalance,
      safes: safeBalances,
      recentTransactions,
      series: days,
      clientBreakdown,
      drawingsTotal,
      settlementNetTotal,
      totalOutstandingWithdrawals,
      sendersWithOutstandingCount: partiesWithOutstanding.size,
      totalSettledGross: Number(settlementTotals._sum.grossAmount ?? 0),
      totalSettledNet: Number(settlementTotals._sum.netAmount ?? 0),
      totalApplied: Number(settlementTotals._sum.appliedAmount ?? 0),
      settlementCount: settlementTotals._count,
      courierCollectionsTotal,
      courierAdvancesTotal,
      courierOutstandingAdvances,
      categoryBreakdown,
      partyTypeBreakdown,
      monthlySeries,
      deferredTrend,
      reconciliationDrift,
      safeBalanceTrend,
      safeSeries: safes.map((s) => ({ id: s.id, name: s.name })),
      pendingCount,
    };
  }

  /**
   * GET /reports?start=&end= — totals + by-category/by-party/by-safe
   * breakdowns over POSTED transactions in range, mirroring the old app's
   * /api/reports endpoint (app/main.py `reports()`).
   */
  async getReports(start?: string, end?: string) {
    const where: any = { status: 'POSTED' };
    if (start || end) {
      where.createdAt = {};
      if (start) where.createdAt.gte = new Date(start);
      if (end) where.createdAt.lte = new Date(end);
    }

    const rows = await this.prisma.transaction.findMany({
      where,
      select: {
        kind: true,
        amount: true,
        createdAt: true,
        safeId: true,
        safe: { select: { name: true } },
        categoryId: true,
        category: { select: { name: true } },
        partyId: true,
        party: { select: { name: true } },
      },
    });

    let income = 0;
    let expense = 0;
    const byCategory = new Map<string, { category: string; kind: string; total: number; count: number }>();
    const byParty = new Map<string, { party: string; kind: string; total: number; count: number }>();
    const bySafe = new Map<string, { safe: string; net: number }>();
    // Daily IN/OUT series over the selected range (Cairo-local day buckets,
    // same convention as getDashboard()'s weekly series) — for a simple
    // chart on the Reports page. TRANSFER rows excluded, same as the
    // income/expense totals above.
    const byDate = new Map<string, { date: string; in: number; out: number }>();

    for (const row of rows) {
      const amount = Number(row.amount);

      // bySafe still needs every row, TRANSFER included — a transfer leg is
      // a real movement of money into/out of that specific safe, even
      // though it's neither company-wide income nor expense. Its `amount`
      // is already signed (negative for the outgoing leg, positive for the
      // incoming leg — see safes.service.ts's getBalance()), so it can be
      // added directly rather than re-deriving a sign from `kind`.
      const safe = bySafe.get(row.safeId) ?? { safe: row.safe.name, net: 0 };
      safe.net += row.kind === 'TRANSFER' ? amount : row.kind === 'IN' ? amount : -amount;
      bySafe.set(row.safeId, safe);

      // Income/expense totals and the category/party breakdowns are about
      // real revenue and spending — a transfer is neither, so it's
      // excluded here (matching getDashboard()'s existing TRANSFER guard).
      if (row.kind === 'TRANSFER') continue;

      if (row.kind === 'IN') income += amount;
      else expense += amount;

      const catKey = `${row.kind}:${row.category?.name ?? ''}`;
      const cat = byCategory.get(catKey) ?? { category: row.category?.name ?? 'بدون بند', kind: row.kind, total: 0, count: 0 };
      cat.total += amount;
      cat.count += 1;
      byCategory.set(catKey, cat);

      const partyKey = `${row.kind}:${row.party?.name ?? ''}`;
      const party = byParty.get(partyKey) ?? { party: row.party?.name ?? 'بدون جهة', kind: row.kind, total: 0, count: 0 };
      party.total += amount;
      party.count += 1;
      byParty.set(partyKey, party);

      const dateKey = toCairoDateString(row.createdAt);
      const bucket = byDate.get(dateKey) ?? { date: dateKey, in: 0, out: 0 };
      if (row.kind === 'IN') bucket.in += amount;
      else bucket.out += amount;
      byDate.set(dateKey, bucket);
    }

    // مناديب breakdown, scoped to this same period (Phase 34e) — previously
    // courier KPIs only existed on the all-time getDashboard() aggregate,
    // giving the Owner no period-scoped courier visibility on this page at
    // all. Kept as 3 separate figures, same as getDashboard()'s own
    // courier KPIs — sheet collections and advances must never be netted
    // against each other (hard rule, see couriers.service.ts).
    const courierDateFilter: any = {};
    if (start) courierDateFilter.gte = new Date(start);
    if (end) courierDateFilter.lte = new Date(end);
    const hasDateFilter = !!(start || end);
    const [courierSheetAgg, courierAdvanceAgg, courierOutstandingAgg] = await Promise.all([
      this.prisma.courierSheetCollection.aggregate({
        where: hasDateFilter ? { date: courierDateFilter } : {},
        _sum: { amount: true },
      }),
      this.prisma.courierAdvance.aggregate({
        where: hasDateFilter ? { createdAt: courierDateFilter } : {},
        _sum: { originalAmount: true },
      }),
      // Outstanding is a point-in-time balance, not a period total — always
      // "as of now", regardless of the selected range, matching
      // getDashboard()'s same all-time semantics for this one figure.
      this.prisma.courierAdvance.aggregate({
        where: { remainingAmount: { gt: 0 } },
        _sum: { remainingAmount: true },
      }),
    ]);

    // مسحوبات / آجل / سلف company-wide report data (Phase 39d) — each kept
    // completely separate from the others (never netted/combined), mirroring
    // the hard rule already enforced for drawings-vs-settlements and
    // sheet-collections-vs-advances elsewhere in this codebase.
    const [drawingsSection, deferredSection, advancesSection] = await Promise.all([
      this.getDrawingsReportSection(courierDateFilter, hasDateFilter),
      this.getDeferredReportSection(courierDateFilter, hasDateFilter),
      this.getAdvancesReportSection(courierDateFilter, hasDateFilter),
    ]);

    return {
      totals: { income, expense, net: income - expense, count: rows.length },
      byCategory: [...byCategory.values()].sort((a, b) => b.total - a.total),
      byParty: [...byParty.values()].sort((a, b) => b.total - a.total),
      bySafe: [...bySafe.values()],
      series: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
      courierCollectionsTotal: Number(courierSheetAgg._sum.amount ?? 0),
      courierAdvancesTotal: Number(courierAdvanceAgg._sum.originalAmount ?? 0),
      courierOutstandingAdvances: Number(courierOutstandingAgg._sum.remainingAmount ?? 0),
      ...drawingsSection,
      ...deferredSection,
      ...advancesSection,
    };
  }

  /**
   * مسحوبات (party drawings, MERCHANT) — period-scoped total/breakdown plus
   * a point-in-time (not period-scoped, same convention as
   * courierOutstandingAdvances) outstanding total and top-5 list. Reuses
   * the exact remaining = amount - sum(WithdrawalApplication) logic
   * PartiesService.getOutstandingDrawings() already implements
   * (parties.service.ts), generalized to run once across every MERCHANT
   * party instead of one.
   */
  private async getDrawingsReportSection(dateFilter: any, hasDateFilter: boolean) {
    const [periodDrawings, allOpenDrawings] = await Promise.all([
      this.prisma.partyDrawing.findMany({
        where: { cancelled: false, ...(hasDateFilter ? { date: dateFilter } : {}) },
        select: { amount: true, party: { select: { name: true } } },
      }),
      this.prisma.partyDrawing.findMany({
        where: { cancelled: false },
        select: { id: true, amount: true, party: { select: { name: true } } },
      }),
    ]);

    let drawingsTotal = 0;
    const byParty = new Map<string, { party: string; total: number; count: number }>();
    for (const d of periodDrawings) {
      const amount = Number(d.amount);
      drawingsTotal += amount;
      const key = d.party?.name ?? 'بدون جهة';
      const entry = byParty.get(key) ?? { party: key, total: 0, count: 0 };
      entry.total += amount;
      entry.count += 1;
      byParty.set(key, entry);
    }

    const drawingIds = allOpenDrawings.map((d) => d.id);
    const appliedSums = drawingIds.length
      ? await this.prisma.withdrawalApplication.groupBy({
          by: ['drawingId'],
          where: { drawingId: { in: drawingIds } },
          _sum: { amount: true },
        })
      : [];
    const appliedByDrawing = new Map(appliedSums.map((a) => [a.drawingId, Number(a._sum.amount ?? 0)]));

    const outstandingByParty = new Map<string, number>();
    let drawingsOutstandingTotal = 0;
    for (const d of allOpenDrawings) {
      const remaining = Math.max(0, Number(d.amount) - (appliedByDrawing.get(d.id) ?? 0));
      if (remaining <= 0) continue;
      drawingsOutstandingTotal += remaining;
      const key = d.party?.name ?? 'بدون جهة';
      outstandingByParty.set(key, (outstandingByParty.get(key) ?? 0) + remaining);
    }

    return {
      drawingsTotal,
      drawingsCount: periodDrawings.length,
      // Each row also carries that same party's CURRENT (point-in-time)
      // remaining/settled state, not just this period's drawn amount — a
      // party can appear "drew in this period" yet already be fully settled,
      // or vice versa (an older drawing still outstanding).
      drawingsByParty: [...byParty.values()]
        .map((row) => {
          const remaining = outstandingByParty.get(row.party) ?? 0;
          return { ...row, remaining, settled: remaining <= 0 };
        })
        .sort((a, b) => b.total - a.total),
      drawingsOutstandingTotal,
      topOutstandingDrawings: [...outstandingByParty.entries()]
        .map(([party, remaining]) => ({ party, remaining }))
        .sort((a, b) => b.remaining - a.remaining)
        .slice(0, 5),
    };
  }

  /** آجل (party deferred, AGENT) — same shape as getDrawingsReportSection(). */
  private async getDeferredReportSection(dateFilter: any, hasDateFilter: boolean) {
    const [periodDeferred, allOpenDeferred] = await Promise.all([
      this.prisma.partyDeferred.findMany({
        where: hasDateFilter ? { createdAt: dateFilter } : {},
        select: { originalAmount: true, party: { select: { name: true } } },
      }),
      this.prisma.partyDeferred.findMany({
        where: { remainingAmount: { gt: 0 } },
        select: { remainingAmount: true, party: { select: { name: true } } },
      }),
    ]);

    let deferredTotal = 0;
    const byParty = new Map<string, { party: string; total: number; count: number }>();
    for (const d of periodDeferred) {
      const amount = Number(d.originalAmount);
      deferredTotal += amount;
      const key = d.party?.name ?? 'بدون جهة';
      const entry = byParty.get(key) ?? { party: key, total: 0, count: 0 };
      entry.total += amount;
      entry.count += 1;
      byParty.set(key, entry);
    }

    const outstandingByParty = new Map<string, number>();
    let deferredOutstandingTotal = 0;
    for (const d of allOpenDeferred) {
      const remaining = Number(d.remainingAmount);
      deferredOutstandingTotal += remaining;
      const key = d.party?.name ?? 'بدون جهة';
      outstandingByParty.set(key, (outstandingByParty.get(key) ?? 0) + remaining);
    }

    return {
      deferredTotal,
      deferredCount: periodDeferred.length,
      deferredByParty: [...byParty.values()]
        .map((row) => {
          const remaining = outstandingByParty.get(row.party) ?? 0;
          return { ...row, remaining, settled: remaining <= 0 };
        })
        .sort((a, b) => b.total - a.total),
      deferredOutstandingTotal,
      topOutstandingDeferred: [...outstandingByParty.entries()]
        .map(([party, remaining]) => ({ party, remaining }))
        .sort((a, b) => b.remaining - a.remaining)
        .slice(0, 5),
    };
  }

  /**
   * سلف (courier advances) — courierCollectionsTotal/courierAdvancesTotal/
   * courierOutstandingAdvances already exist on getReports()'s own top
   * level (all-time); this adds the missing period-scoped per-courier
   * breakdown and a top-5 outstanding list, same pattern as the two
   * sections above.
   */
  private async getAdvancesReportSection(dateFilter: any, hasDateFilter: boolean) {
    const [periodAdvances, allOpenAdvances] = await Promise.all([
      this.prisma.courierAdvance.findMany({
        where: hasDateFilter ? { createdAt: dateFilter } : {},
        select: { originalAmount: true, courier: { select: { name: true } } },
      }),
      this.prisma.courierAdvance.findMany({
        where: { remainingAmount: { gt: 0 } },
        select: { remainingAmount: true, courier: { select: { name: true } } },
      }),
    ]);

    const byCourier = new Map<string, { courier: string; total: number; count: number }>();
    for (const a of periodAdvances) {
      const amount = Number(a.originalAmount);
      const key = a.courier?.name ?? 'بدون مندوب';
      const entry = byCourier.get(key) ?? { courier: key, total: 0, count: 0 };
      entry.total += amount;
      entry.count += 1;
      byCourier.set(key, entry);
    }

    const outstandingByCourier = new Map<string, number>();
    for (const a of allOpenAdvances) {
      const remaining = Number(a.remainingAmount);
      const key = a.courier?.name ?? 'بدون مندوب';
      outstandingByCourier.set(key, (outstandingByCourier.get(key) ?? 0) + remaining);
    }

    return {
      advancesByCourier: [...byCourier.values()]
        .map((row) => {
          const remaining = outstandingByCourier.get(row.courier) ?? 0;
          return { ...row, remaining, settled: remaining <= 0 };
        })
        .sort((a, b) => b.total - a.total),
      topOutstandingCourierAdvances: [...outstandingByCourier.entries()]
        .map(([courier, remaining]) => ({ courier, remaining }))
        .sort((a, b) => b.remaining - a.remaining)
        .slice(0, 5),
    };
  }
}
