import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from './reports.service';
import { getCurrentCairoWeekStartUtc } from '../common/cairo-time';

/**
 * Focused on getReports() — the money-affecting aggregate other pages rely
 * on for income/expense totals. Regression test for the bug where TRANSFER
 * rows (safe-to-safe moves, not real income/expense) fell into the `else`
 * branch and were counted as expenses.
 */
describe('ReportsService - getReports()', () => {
  let service: ReportsService;

  const rows = [
    { kind: 'IN', amount: 1000, safeId: 'safe-a', safe: { name: 'Safe A' }, categoryId: 'c1', category: { name: 'Income' }, partyId: null, party: null },
    { kind: 'OUT', amount: 300, safeId: 'safe-a', safe: { name: 'Safe A' }, categoryId: 'c2', category: { name: 'Expense' }, partyId: null, party: null },
    // A transfer's amount is already signed (negative on the outgoing leg,
    // positive on the incoming leg) — mirrors how safes.service.ts's
    // transfer() actually stores the two linked rows.
    { kind: 'TRANSFER', amount: -400, safeId: 'safe-a', safe: { name: 'Safe A' }, categoryId: null, category: null, partyId: null, party: null },
    { kind: 'TRANSFER', amount: 400, safeId: 'safe-b', safe: { name: 'Safe B' }, categoryId: null, category: null, partyId: null, party: null },
  ];

  beforeEach(async () => {
    const prismaMock: any = {
      transaction: {
        findMany: jest.fn(() => Promise.resolve(rows)),
      },
      courierSheetCollection: { aggregate: jest.fn(() => Promise.resolve({ _sum: { amount: null } })) },
      courierAdvance: {
        aggregate: jest.fn(() => Promise.resolve({ _sum: { originalAmount: null, remainingAmount: null } })),
        findMany: jest.fn(() => Promise.resolve([])),
      },
      partyDrawing: { findMany: jest.fn(() => Promise.resolve([])) },
      withdrawalApplication: { groupBy: jest.fn(() => Promise.resolve([])) },
      partyDeferred: { findMany: jest.fn(() => Promise.resolve([])) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: 'CACHE_MANAGER', useValue: { get: jest.fn(() => Promise.resolve(undefined)), set: jest.fn() } },
      ],
    }).compile();

    service = module.get(ReportsService);
  });

  describe('getDashboard() caching', () => {
    it('returns the cached value on a hit without touching Prisma', async () => {
      const cached = { totalBalance: 999 };
      const cacheMock = { get: jest.fn(() => Promise.resolve(cached)), set: jest.fn() };
      const prismaMock: any = { transaction: { findMany: jest.fn() }, safe: { findMany: jest.fn() } };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ReportsService,
          { provide: PrismaService, useValue: prismaMock },
          { provide: 'CACHE_MANAGER', useValue: cacheMock },
        ],
      }).compile();

      const result = await module.get(ReportsService).getDashboard();
      expect(result).toBe(cached);
      expect(prismaMock.safe.findMany).not.toHaveBeenCalled();
    });

    it('computes and caches on a miss', async () => {
      const cacheMock = { get: jest.fn(() => Promise.resolve(undefined)), set: jest.fn() };
      const prismaMock: any = {
        safe: { findMany: jest.fn(() => Promise.resolve([])) },
        transaction: { findMany: jest.fn(() => Promise.resolve([])) },
        pendingAction: { count: jest.fn(() => Promise.resolve(0)) },
        partyDeferred: { findMany: jest.fn(() => Promise.resolve([])) },
        partyDeferredPayment: { findMany: jest.fn(() => Promise.resolve([])) },
        reconciliation: { findMany: jest.fn(() => Promise.resolve([])) },
        partyDrawing: { findMany: jest.fn(() => Promise.resolve([])) },
        withdrawalApplication: { groupBy: jest.fn(() => Promise.resolve([])) },
        partySettlement: {
          aggregate: jest.fn(() =>
            Promise.resolve({ _sum: { grossAmount: null, appliedAmount: null, netAmount: null }, _count: 0 }),
          ),
        },
        courierSheetCollection: { aggregate: jest.fn(() => Promise.resolve({ _sum: { amount: null } })) },
        courierAdvance: { aggregate: jest.fn(() => Promise.resolve({ _sum: { originalAmount: null, remainingAmount: null } })) },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ReportsService,
          { provide: PrismaService, useValue: prismaMock },
          { provide: 'CACHE_MANAGER', useValue: cacheMock },
        ],
      }).compile();

      await module.get(ReportsService).getDashboard();
      expect(prismaMock.safe.findMany).toHaveBeenCalled();
      expect(cacheMock.set).toHaveBeenCalledWith('reports:dashboard', expect.anything(), 20_000);
    });
  });

  it('excludes TRANSFER rows from income/expense totals', async () => {
    const result = await service.getReports();

    expect(result.totals.income).toBe(1000);
    expect(result.totals.expense).toBe(300);
    expect(result.totals.count).toBe(4);
  });

  it('excludes TRANSFER rows from the category and party breakdowns', async () => {
    const result = await service.getReports();

    const transferInCategories = result.byCategory.some((c) => c.category === 'بدون بند' && c.kind === 'TRANSFER');
    expect(transferInCategories).toBe(false);
    expect(result.byCategory).toHaveLength(2);
  });

  it('still nets TRANSFER legs correctly per safe using their signed amount', async () => {
    const result = await service.getReports();

    const safeA = result.bySafe.find((s) => s.safe === 'Safe A')!;
    const safeB = result.bySafe.find((s) => s.safe === 'Safe B')!;
    // Safe A: +1000 (IN) - 300 (OUT) - 400 (outgoing transfer leg) = 300.
    expect(safeA.net).toBe(300);
    // Safe B only received the incoming transfer leg.
    expect(safeB.net).toBe(400);
  });

  // Phase 34e: net moved server-side, and courier KPIs are now period-aware
  // on this endpoint too (previously only on getDashboard()'s all-time
  // aggregate) — kept as 3 separate figures, never netted against each
  // other, same discipline as everywhere else couriers appear.
  it('computes net server-side and returns the 3 courier KPIs as independent figures', async () => {
    const result = await service.getReports();
    expect(result.totals.net).toBe(700); // 1000 income - 300 expense
    expect(result.courierCollectionsTotal).toBe(0);
    expect(result.courierAdvancesTotal).toBe(0);
    expect(result.courierOutstandingAdvances).toBe(0);
  });
});

/**
 * Phase 39d: مسحوبات/آجل/سلف company-wide report sections — period totals
 * only count rows created in the selected range, while outstanding totals
 * and the top-5 lists are point-in-time (unaffected by the date range),
 * and the three ledger types are never merged into one combined ranking.
 */
describe('ReportsService - getReports() drawings/deferred/advances sections', () => {
  async function makeService(overrides: any) {
    const prismaMock: any = {
      transaction: { findMany: jest.fn(() => Promise.resolve([])) },
      courierSheetCollection: { aggregate: jest.fn(() => Promise.resolve({ _sum: { amount: null } })) },
      courierAdvance: {
        aggregate: jest.fn(() => Promise.resolve({ _sum: { originalAmount: null, remainingAmount: null } })),
        findMany: jest.fn(() => Promise.resolve([])),
      },
      partyDrawing: { findMany: jest.fn(() => Promise.resolve([])) },
      withdrawalApplication: { groupBy: jest.fn(() => Promise.resolve([])) },
      partyDeferred: { findMany: jest.fn(() => Promise.resolve([])) },
      ...overrides,
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: 'CACHE_MANAGER', useValue: { get: jest.fn(() => Promise.resolve(undefined)), set: jest.fn() } },
      ],
    }).compile();
    return module.get(ReportsService);
  }

  it('drawingsTotal only counts drawings created within the selected period, while drawingsOutstandingTotal/topOutstandingDrawings stay point-in-time', async () => {
    // partyDrawing.findMany is called twice inside getDrawingsReportSection:
    // once with a date filter (period rows) and once without (all open
    // rows, for the outstanding computation) — simulate both by returning
    // a different result based on whether `where.date` is present.
    const periodRow = { amount: 1000, party: { name: 'Paris' } };
    const allOpenRow = { id: 'd1', amount: 5000, party: { name: 'Paris' } };
    const findMany = jest.fn(({ where }: any) =>
      Promise.resolve(where?.date ? [periodRow] : [allOpenRow]),
    );
    const service = await makeService({
      partyDrawing: { findMany },
      withdrawalApplication: { groupBy: jest.fn(() => Promise.resolve([])) },
    });

    const result: any = await service.getReports('2026-01-01', '2026-01-31');

    expect(result.drawingsTotal).toBe(1000); // only the period row
    expect(result.drawingsOutstandingTotal).toBe(5000); // the all-open row, unaffected by the date range
    expect(result.topOutstandingDrawings).toEqual([{ party: 'Paris', remaining: 5000 }]);
  });

  it('deferredOutstandingTotal/topOutstandingDeferred are point-in-time regardless of the date range', async () => {
    const service = await makeService({
      partyDeferred: {
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(
            where?.createdAt
              ? [{ originalAmount: 2000, party: { name: 'Cairo Agent' } }]
              : [{ remainingAmount: 7000, party: { name: 'Cairo Agent' } }],
          ),
        ),
      },
    });

    const result: any = await service.getReports('2026-01-01', '2026-01-31');

    expect(result.deferredTotal).toBe(2000);
    expect(result.deferredOutstandingTotal).toBe(7000);
    expect(result.topOutstandingDeferred).toEqual([{ party: 'Cairo Agent', remaining: 7000 }]);
  });

  it('drawingsByParty/deferredByParty/advancesByCourier rows each carry that entity\'s current remaining/settled state', async () => {
    const service = await makeService({
      partyDrawing: {
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(
            where?.date
              ? [{ amount: 1000, party: { name: 'Paris' } }]
              : [{ id: 'd1', amount: 1000, party: { name: 'Paris' } }],
          ),
        ),
      },
      withdrawalApplication: {
        // Fully applied — Paris should show settled:true, remaining:0.
        groupBy: jest.fn(() => Promise.resolve([{ drawingId: 'd1', _sum: { amount: 1000 } }])),
      },
      partyDeferred: {
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(
            where?.createdAt
              ? [{ originalAmount: 500, party: { name: 'Cairo Agent' } }]
              : [{ remainingAmount: 200, party: { name: 'Cairo Agent' } }],
          ),
        ),
      },
      courierAdvance: {
        aggregate: jest.fn(() => Promise.resolve({ _sum: { originalAmount: null, remainingAmount: null } })),
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(
            where?.createdAt
              ? [{ originalAmount: 300, courier: { name: 'Courier X' } }]
              : [],
          ),
        ),
      },
    });

    const result: any = await service.getReports('2026-01-01', '2026-01-31');

    expect(result.drawingsByParty[0]).toMatchObject({ party: 'Paris', remaining: 0, settled: true });
    expect(result.deferredByParty[0]).toMatchObject({ party: 'Cairo Agent', remaining: 200, settled: false });
    expect(result.advancesByCourier[0]).toMatchObject({ courier: 'Courier X', remaining: 0, settled: true });
  });

  it('keeps drawings/deferred/courier-advance outstanding lists completely separate, never merged into one ranking', async () => {
    const service = await makeService({
      partyDrawing: {
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(where?.date ? [] : [{ id: 'd1', amount: 100, party: { name: 'Sender A' } }]),
        ),
      },
      partyDeferred: {
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(where?.createdAt ? [] : [{ remainingAmount: 200, party: { name: 'Agent B' } }]),
        ),
      },
      courierAdvance: {
        aggregate: jest.fn(() => Promise.resolve({ _sum: { originalAmount: null, remainingAmount: null } })),
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(where?.createdAt ? [] : [{ remainingAmount: 300, courier: { name: 'Courier C' } }]),
        ),
      },
    });

    const result: any = await service.getReports();

    expect(result.topOutstandingDrawings).toEqual([{ party: 'Sender A', remaining: 100 }]);
    expect(result.topOutstandingDeferred).toEqual([{ party: 'Agent B', remaining: 200 }]);
    expect(result.topOutstandingCourierAdvances).toEqual([{ courier: 'Courier C', remaining: 300 }]);
    // Each list only ever contains its own ledger type's names.
    expect(result.topOutstandingDrawings.some((r: any) => r.party === 'Agent B' || r.party === 'Courier C')).toBe(false);
  });
});

describe('ReportsService - getDashboard() weekly (Cairo-anchored) series', () => {
  it('includes a transaction just inside the current Cairo week and excludes one just before it', async () => {
    const weekStart = getCurrentCairoWeekStartUtc();
    const justAfterStart = new Date(weekStart.getTime() + 60_000); // 1 minute into the week
    const justBeforeStart = new Date(weekStart.getTime() - 60_000); // 1 minute before the week

    const rows = [
      { safeId: 'safe-a', kind: 'IN', amount: 500, createdAt: justAfterStart, partyId: null, party: null, categoryId: null, category: null },
      { safeId: 'safe-a', kind: 'IN', amount: 999, createdAt: justBeforeStart, partyId: null, party: null, categoryId: null, category: null },
    ];

    const prismaMock: any = {
      safe: { findMany: jest.fn(() => Promise.resolve([{ id: 'safe-a', name: 'Safe A', openingBalance: 0, createdAt: new Date() }])) },
      transaction: {
        findMany: jest.fn(({ select }: any) => Promise.resolve(select ? rows : [])),
      },
      pendingAction: { count: jest.fn(() => Promise.resolve(0)) },
      partyDeferred: { findMany: jest.fn(() => Promise.resolve([])) },
      partyDeferredPayment: { findMany: jest.fn(() => Promise.resolve([])) },
      reconciliation: { findMany: jest.fn(() => Promise.resolve([])) },
      partyDrawing: { findMany: jest.fn(() => Promise.resolve([])) },
      withdrawalApplication: { groupBy: jest.fn(() => Promise.resolve([])) },
      partySettlement: {
        aggregate: jest.fn(() =>
          Promise.resolve({ _sum: { grossAmount: null, appliedAmount: null, netAmount: null }, _count: 0 }),
        ),
      },
      courierSheetCollection: { aggregate: jest.fn(() => Promise.resolve({ _sum: { amount: null } })) },
      courierAdvance: { aggregate: jest.fn(() => Promise.resolve({ _sum: { originalAmount: null, remainingAmount: null } })) },
    };
    const cacheMock = { get: jest.fn(() => Promise.resolve(undefined)), set: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: 'CACHE_MANAGER', useValue: cacheMock },
      ],
    }).compile();

    const result: any = await module.get(ReportsService).getDashboard();

    expect(result.series).toHaveLength(7);
    const totalIn = result.series.reduce((sum: number, d: any) => sum + d.in, 0);
    expect(totalIn).toBe(500); // only the in-week transaction counted
  });
});

/**
 * Phase 22: a withdrawal applied against a later settlement must never be
 * double-counted — the settlement's own Transaction already carries the
 * NET amount (gross - applied), so summing drawingsTotal + settlementNetTotal
 * must equal the real total cash that left the safe, never more.
 */
describe('ReportsService - withdrawal/settlement totals do not double-count', () => {
  it('a 50k drawing + a 300k-gross/50k-applied settlement sums to exactly 300k OUT, never 350k', async () => {
    // Monday: 50k drawing (OUT, MERCHANT_DRAWING). Thursday: settlement
    // posts only its NET cash (300k gross - 50k applied = 250k OUT,
    // MERCHANT_SENDER) — exactly as PartiesService.createSettlement()
    // actually records it.
    const rows = [
      {
        safeId: 'safe-a',
        kind: 'OUT',
        amount: 50_000,
        createdAt: new Date(),
        partyId: 'party-1',
        party: { name: 'Paris', partyType: 'MERCHANT' },
        categoryId: 'cat-drawing',
        category: { name: 'مسحوبات', kind: 'OUT', partyType: 'MERCHANT', systemKey: 'MERCHANT_DRAWING' },
      },
      {
        safeId: 'safe-a',
        kind: 'OUT',
        amount: 250_000,
        createdAt: new Date(),
        partyId: 'party-1',
        party: { name: 'Paris', partyType: 'MERCHANT' },
        categoryId: 'cat-sender',
        category: { name: 'رواسل', kind: 'OUT', partyType: 'MERCHANT', systemKey: 'MERCHANT_SENDER' },
      },
    ];

    const prismaMock: any = {
      safe: { findMany: jest.fn(() => Promise.resolve([{ id: 'safe-a', name: 'Safe A', openingBalance: 0, createdAt: new Date() }])) },
      transaction: { findMany: jest.fn(({ select }: any) => Promise.resolve(select ? rows : [])) },
      pendingAction: { count: jest.fn(() => Promise.resolve(0)) },
      partyDeferred: { findMany: jest.fn(() => Promise.resolve([])) },
      partyDeferredPayment: { findMany: jest.fn(() => Promise.resolve([])) },
      reconciliation: { findMany: jest.fn(() => Promise.resolve([])) },
      partyDrawing: {
        findMany: jest.fn(() => Promise.resolve([{ id: 'd1', partyId: 'party-1', amount: 50_000 }])),
      },
      withdrawalApplication: {
        groupBy: jest.fn(() => Promise.resolve([{ drawingId: 'd1', _sum: { amount: 50_000 } }])),
      },
      partySettlement: {
        aggregate: jest.fn(() =>
          Promise.resolve({
            _sum: { grossAmount: 300_000, appliedAmount: 50_000, netAmount: 250_000 },
            _count: 1,
          }),
        ),
      },
      courierSheetCollection: { aggregate: jest.fn(() => Promise.resolve({ _sum: { amount: null } })) },
      courierAdvance: { aggregate: jest.fn(() => Promise.resolve({ _sum: { originalAmount: null, remainingAmount: null } })) },
    };
    const cacheMock = { get: jest.fn(() => Promise.resolve(undefined)), set: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: 'CACHE_MANAGER', useValue: cacheMock },
      ],
    }).compile();

    const result: any = await module.get(ReportsService).getDashboard();

    expect(result.drawingsTotal).toBe(50_000);
    expect(result.settlementNetTotal).toBe(250_000);
    expect(result.drawingsTotal + result.settlementNetTotal).toBe(300_000);
    // The withdrawal was fully applied — nothing outstanding remains.
    expect(result.totalOutstandingWithdrawals).toBe(0);
    expect(result.sendersWithOutstandingCount).toBe(0);
    expect(result.totalSettledGross).toBe(300_000);
    expect(result.totalApplied).toBe(50_000);
  });
});
