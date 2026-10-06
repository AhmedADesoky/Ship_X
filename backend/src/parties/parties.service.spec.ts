import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SafesService } from '../safes/safes.service';
import { PartiesService } from './parties.service';

// Defaults to "always sufficient" across this file — the dedicated
// negative-balance test overrides this to actually reject.
const makeSafesServiceMock = () => ({ assertSufficientBalance: jest.fn(() => Promise.resolve()) });

/**
 * NOTE: No live Postgres instance is available in this environment, so
 * PrismaService is fully mocked here (in-memory fakes for the relevant
 * tables). This tests the drawing/deferred-payment math and guard logic,
 * not real Postgres transactional semantics.
 */
describe('PartiesService - drawings & deferred payments', () => {
  let service: PartiesService;
  let deferredRow: { id: string; partyId: string; originalAmount: number; remainingAmount: number };
  let payments: any[];
  let drawings: any[];
  let transactions: any[];

  const makePrismaMock = () => {
    const tx = {
      party: {
        findUnique: jest.fn(() => Promise.resolve({ id: 'party-1', active: true })),
      },
      partyDeferred: {
        findUnique: jest.fn(({ where: { id } }: any) =>
          Promise.resolve(id === deferredRow.id ? { ...deferredRow } : null),
        ),
        update: jest.fn(({ data }: any) => {
          Object.assign(deferredRow, data);
          return Promise.resolve({ ...deferredRow });
        }),
      },
      safe: {
        findUnique: jest.fn(() => Promise.resolve({ id: 'safe-a', name: 'Safe A' })),
      },
      transaction: {
        create: jest.fn(({ data }: any) => {
          const row = { id: `tx${transactions.length + 1}`, ...data };
          transactions.push(row);
          return Promise.resolve(row);
        }),
      },
      partyDrawing: {
        create: jest.fn(({ data }: any) => {
          const row = { id: `d${drawings.length + 1}`, ...data };
          drawings.push(row);
          return Promise.resolve(row);
        }),
      },
      partyDeferredPayment: {
        create: jest.fn(({ data }: any) => {
          const row = { id: `p${payments.length + 1}`, ...data };
          payments.push(row);
          return Promise.resolve(row);
        }),
      },
    };

    return {
      $transaction: jest.fn((cb: any) => cb(tx)),
      party: {
        findUnique: jest.fn(() => Promise.resolve({ id: 'party-1', active: true })),
      },
      category: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        findFirst: jest.fn(() => Promise.resolve(null)),
      },
      // Used by computeDrawingsTotal() (summary()/getOutstandingDrawingsTotal()).
      // Empty by default; individual tests override when they need
      // otherwise. createDrawing() itself no longer checks this — multiple
      // outstanding drawings are allowed (see test below).
      partyDrawing: {
        findMany: jest.fn(() => Promise.resolve([])),
      },
      transaction: {
        findMany: jest.fn(() => Promise.resolve([])),
        aggregate: jest.fn(() => Promise.resolve({ _sum: { amount: null } })),
      },
    };
  };

  beforeEach(async () => {
    payments = [];
    drawings = [];
    transactions = [];
    deferredRow = {
      id: 'deferred-1',
      partyId: 'party-1',
      originalAmount: 1000,
      remainingAmount: 1000,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PartiesService,
        { provide: PrismaService, useValue: makePrismaMock() },
        { provide: SafesService, useValue: makeSafesServiceMock() },
      ],
    }).compile();

    service = module.get(PartiesService);
  });

  it('createDrawing() rejects when the safe cannot cover it, and writes nothing', async () => {
    const safesMock = { assertSufficientBalance: jest.fn(() => Promise.reject(new BadRequestException('غير كافٍ'))) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PartiesService,
        { provide: PrismaService, useValue: makePrismaMock() },
        { provide: SafesService, useValue: safesMock },
      ],
    }).compile();
    const rejectingService = module.get(PartiesService);

    await expect(
      rejectingService.createDrawing('party-1', { safeId: 'safe-a', amount: 5000 }, 'user-1'),
    ).rejects.toThrow(BadRequestException);
    expect(transactions).toHaveLength(0);
    expect(drawings).toHaveLength(0);
  });

  it('creates a linked OUT transaction for a party drawing, referenced by the drawing row', async () => {
    const drawing = await service.createDrawing(
      'party-1',
      { safeId: 'safe-a', amount: 250, note: 'test drawing' },
      'user-1',
    );

    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      safeId: 'safe-a',
      kind: 'OUT',
      amount: 250,
      partyId: 'party-1',
    });
    expect(drawing.transactionId).toBe(transactions[0].id);
    expect(drawing.amount).toBe(250);
    expect(drawing.safeId).toBe('safe-a');
  });

  it('allows a new مسحوبات entry even when the party already has an outstanding (un-redeposited) drawing', async () => {
    const prismaMock = makePrismaMock();
    // Simulate one prior live drawing with no redeposit yet — computeDrawingsTotal
    // would report totalDrawings > 0 for this party.
    (prismaMock.partyDrawing.findMany as jest.Mock).mockResolvedValue([
      { id: 'd-existing', partyId: 'party-1', transactionId: 't-existing', amount: 10000 },
    ]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PartiesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: SafesService, useValue: makeSafesServiceMock() },
      ],
    }).compile();
    const serviceWithOutstanding = module.get(PartiesService);

    await expect(
      serviceWithOutstanding.createDrawing('party-1', { safeId: 'safe-a', amount: 5000 }, 'user-1'),
    ).resolves.toBeDefined();
  });

  it('reduces remaining_amount correctly on a partial deferred payment', async () => {
    const result = await service.createDeferredPayment(
      'party-1',
      'deferred-1',
      { safeId: 'safe-a', amount: 400 },
      'user-1',
    );

    expect(result.deferred.remainingAmount).toBe(600);
    expect(deferredRow.remainingAmount).toBe(600);
    expect(payments).toHaveLength(1);
  });

  it('reduces remaining_amount to zero across two partial payments', async () => {
    await service.createDeferredPayment('party-1', 'deferred-1', { safeId: 'safe-a', amount: 400 }, 'user-1');
    const second = await service.createDeferredPayment(
      'party-1',
      'deferred-1',
      { safeId: 'safe-a', amount: 600 },
      'user-1',
    );

    expect(second.deferred.remainingAmount).toBe(0);
  });

  it('rejects a payment that would exceed the remaining balance', async () => {
    await expect(
      service.createDeferredPayment('party-1', 'deferred-1', { safeId: 'safe-a', amount: 1500 }, 'user-1'),
    ).rejects.toThrow(BadRequestException);

    // Remaining balance must be untouched by the rejected attempt.
    expect(deferredRow.remainingAmount).toBe(1000);
  });
});

/**
 * syncDeferredPaymentForTransaction() — the FIFO auto-apply-against-
 * outstanding-آجل logic wired into TransactionsService's create()/
 * update()/void() for any IN transaction against an AGENT party. Modeled
 * as an in-memory `tx` fake supporting the Prisma increment/decrement
 * update syntax the real method uses, following this repo's established
 * array-based mock pattern (see transactions.service.spec.ts).
 */
describe('PartiesService - syncDeferredPaymentForTransaction()', () => {
  let service: PartiesService;
  let deferredRows: { id: string; partyId: string; remainingAmount: number; createdAt: Date }[];
  let payments: { id: string; deferredId: string; safeId: string; amount: number; transactionId: string }[];
  let idCounter: number;

  const applyIncDec = (current: number, data: any) => {
    if (data && typeof data === 'object') {
      if ('increment' in data) return current + Number(data.increment);
      if ('decrement' in data) return current - Number(data.decrement);
    }
    return Number(data);
  };

  const makeTx = () => ({
    partyDeferredPayment: {
      findMany: jest.fn(({ where: { transactionId } }: any) =>
        Promise.resolve(payments.filter((p) => p.transactionId === transactionId)),
      ),
      deleteMany: jest.fn(({ where: { transactionId } }: any) => {
        payments = payments.filter((p) => p.transactionId !== transactionId);
        return Promise.resolve({ count: 0 });
      }),
      create: jest.fn(({ data }: any) => {
        const row = { id: `p${idCounter++}`, ...data };
        payments.push(row);
        return Promise.resolve(row);
      }),
    },
    partyDeferred: {
      update: jest.fn(({ where: { id }, data }: any) => {
        const row = deferredRows.find((r) => r.id === id);
        row!.remainingAmount = applyIncDec(row!.remainingAmount, data.remainingAmount);
        return Promise.resolve({ ...row });
      }),
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          deferredRows
            .filter((r) => r.partyId === where.partyId && r.remainingAmount > 0)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
        ),
      ),
    },
  });

  let tx: ReturnType<typeof makeTx>;

  beforeEach(async () => {
    idCounter = 1;
    payments = [];
    deferredRows = [];

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PartiesService,
        { provide: PrismaService, useValue: {} },
        { provide: SafesService, useValue: makeSafesServiceMock() },
      ],
    }).compile();

    service = module.get(PartiesService);
    tx = makeTx();
  });

  it('applies FIFO across two open deferred records, oldest first', async () => {
    deferredRows = [
      { id: 'd1', partyId: 'party-1', remainingAmount: 300, createdAt: new Date('2026-01-01') },
      { id: 'd2', partyId: 'party-1', remainingAmount: 500, createdAt: new Date('2026-02-01') },
    ];

    await service.syncDeferredPaymentForTransaction(tx as any, 'tx-1', {
      partyId: 'party-1',
      safeId: 'safe-a',
      amount: 600,
    });

    expect(deferredRows.find((r) => r.id === 'd1')!.remainingAmount).toBe(0);
    expect(deferredRows.find((r) => r.id === 'd2')!.remainingAmount).toBe(200);
    expect(payments).toHaveLength(2);
    expect(payments[0]).toMatchObject({ deferredId: 'd1', amount: 300 });
    expect(payments[1]).toMatchObject({ deferredId: 'd2', amount: 300 });
  });

  it('applies only a partial amount when it is less than the outstanding balance', async () => {
    deferredRows = [{ id: 'd1', partyId: 'party-1', remainingAmount: 1000, createdAt: new Date() }];

    await service.syncDeferredPaymentForTransaction(tx as any, 'tx-1', {
      partyId: 'party-1',
      safeId: 'safe-a',
      amount: 250,
    });

    expect(deferredRows[0].remainingAmount).toBe(750);
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(250);
  });

  it('is a no-op when the party has no open deferred balance', async () => {
    deferredRows = [];

    await service.syncDeferredPaymentForTransaction(tx as any, 'tx-1', {
      partyId: 'party-1',
      safeId: 'safe-a',
      amount: 400,
    });

    expect(payments).toHaveLength(0);
  });

  it('leaves any excess beyond the outstanding balance unapplied', async () => {
    deferredRows = [{ id: 'd1', partyId: 'party-1', remainingAmount: 100, createdAt: new Date() }];

    await service.syncDeferredPaymentForTransaction(tx as any, 'tx-1', {
      partyId: 'party-1',
      safeId: 'safe-a',
      amount: 900,
    });

    expect(deferredRows[0].remainingAmount).toBe(0);
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(100);
  });

  it('re-syncing with a new amount reverses the old application before reapplying (edit is idempotent)', async () => {
    deferredRows = [{ id: 'd1', partyId: 'party-1', remainingAmount: 1000, createdAt: new Date() }];

    await service.syncDeferredPaymentForTransaction(tx as any, 'tx-1', {
      partyId: 'party-1',
      safeId: 'safe-a',
      amount: 300,
    });
    expect(deferredRows[0].remainingAmount).toBe(700);

    await service.syncDeferredPaymentForTransaction(tx as any, 'tx-1', {
      partyId: 'party-1',
      safeId: 'safe-a',
      amount: 500,
    });

    expect(deferredRows[0].remainingAmount).toBe(500);
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(500);
  });

  it('void (params: null) restores remainingAmount and deletes the linked payment rows', async () => {
    deferredRows = [{ id: 'd1', partyId: 'party-1', remainingAmount: 1000, createdAt: new Date() }];

    await service.syncDeferredPaymentForTransaction(tx as any, 'tx-1', {
      partyId: 'party-1',
      safeId: 'safe-a',
      amount: 400,
    });
    expect(deferredRows[0].remainingAmount).toBe(600);

    await service.syncDeferredPaymentForTransaction(tx as any, 'tx-1', null);

    expect(deferredRows[0].remainingAmount).toBe(1000);
    expect(payments).toHaveLength(0);
  });
});

/**
 * createSettlement()/getOutstandingDrawings()/cancelDrawing() — the
 * withdrawal-application ledger (Phase 22). A withdrawal is never
 * reversed/re-entered; applying it only records a WithdrawalApplication
 * row, derived-live outstanding math (no stored running total). Modeled as
 * in-memory arrays, same established pattern as the drawing/deferred
 * describe block above.
 */
describe('PartiesService - settlements (withdrawal-application ledger)', () => {
  let service: PartiesService;
  let drawings: { id: string; partyId: string; safeId: string; amount: number; cancelled: boolean; date: Date }[];
  let applications: { id: string; drawingId: string; settlementId: string; amount: number }[];
  let settlements: any[];
  let txRows: any[];
  let idCounter: number;

  const makePrisma = () => {
    const tx: any = {
      safe: { findUnique: jest.fn(() => Promise.resolve({ id: 'safe-a', name: 'Safe A' })) },
      partyDrawing: {
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(
            drawings
              .filter((d) => d.partyId === where.partyId && d.cancelled === where.cancelled)
              .sort((a, b) => a.date.getTime() - b.date.getTime()),
          ),
        ),
        update: jest.fn(({ where: { id }, data }: any) => {
          const row = drawings.find((d) => d.id === id);
          Object.assign(row!, data);
          return Promise.resolve({ ...row });
        }),
      },
      withdrawalApplication: {
        groupBy: jest.fn(({ where }: any) => {
          const ids: string[] = where.drawingId.in;
          const sums = new Map<string, number>();
          for (const a of applications) {
            if (!ids.includes(a.drawingId)) continue;
            sums.set(a.drawingId, (sums.get(a.drawingId) ?? 0) + a.amount);
          }
          return Promise.resolve([...sums.entries()].map(([drawingId, amount]) => ({ drawingId, _sum: { amount } })));
        }),
        createMany: jest.fn(({ data }: any) => {
          for (const d of data) applications.push({ id: `a${idCounter++}`, ...d });
          return Promise.resolve({ count: data.length });
        }),
        aggregate: jest.fn(({ where }: any) => {
          const sum = applications
            .filter((a) => a.drawingId === where.drawingId)
            .reduce((s, a) => s + a.amount, 0);
          return Promise.resolve({ _sum: { amount: sum || null } });
        }),
      },
      transaction: {
        create: jest.fn(({ data }: any) => {
          const row = { id: `t${idCounter++}`, status: 'POSTED', ...data };
          txRows.push(row);
          return Promise.resolve(row);
        }),
      },
      partySettlement: {
        create: jest.fn(({ data }: any) => {
          const row = { id: `s${idCounter++}`, ...data };
          settlements.push(row);
          return Promise.resolve(row);
        }),
        findUnique: jest.fn(({ where: { id } }: any) =>
          Promise.resolve(settlements.find((s) => s.id === id) ?? null),
        ),
      },
    };

    return {
      $transaction: jest.fn((cb: any) => cb(tx)),
      party: { findUnique: jest.fn(() => Promise.resolve({ id: 'party-1', partyType: 'MERCHANT', active: true })) },
      category: { findUnique: jest.fn(() => Promise.resolve({ id: 'cat-sender', systemKey: 'MERCHANT_SENDER' })) },
      partyDrawing: {
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(drawings.filter((d) => d.partyId === where.partyId && d.cancelled === false)),
        ),
        findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(drawings.find((d) => d.id === id) ?? null)),
        update: jest.fn(({ where: { id }, data }: any) => {
          const row = drawings.find((d) => d.id === id);
          Object.assign(row!, data);
          return Promise.resolve({ ...row });
        }),
      },
      withdrawalApplication: {
        groupBy: jest.fn(({ where }: any) => {
          const ids: string[] = where.drawingId.in;
          const sums = new Map<string, number>();
          for (const a of applications) {
            if (!ids.includes(a.drawingId)) continue;
            sums.set(a.drawingId, (sums.get(a.drawingId) ?? 0) + a.amount);
          }
          return Promise.resolve([...sums.entries()].map(([drawingId, amount]) => ({ drawingId, _sum: { amount } })));
        }),
        aggregate: jest.fn(({ where }: any) => {
          const sum = applications
            .filter((a) => a.drawingId === where.drawingId)
            .reduce((s, a) => s + a.amount, 0);
          return Promise.resolve({ _sum: { amount: sum || null } });
        }),
      },
      partySettlement: {
        findUnique: jest.fn(() => Promise.resolve(null)), // no clientRequestId collisions by default
      },
      transaction: { findMany: jest.fn(() => Promise.resolve([])) },
    };
  };

  const makeDrawing = (id: string, amount: number, date = new Date()) => ({
    id,
    partyId: 'party-1',
    safeId: 'safe-a',
    amount,
    cancelled: false,
    date,
  });

  beforeEach(async () => {
    idCounter = 1;
    applications = [];
    settlements = [];
    txRows = [];
    drawings = [];

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PartiesService,
        { provide: PrismaService, useValue: makePrisma() },
        { provide: SafesService, useValue: makeSafesServiceMock() },
      ],
    }).compile();

    service = module.get(PartiesService);
  });

  it('rejects a non-positive gross amount', async () => {
    await expect(
      service.createSettlement('party-1', { safeId: 'safe-a', grossAmount: 0, applicationMode: 'NONE' } as any, 'user-1'),
    ).rejects.toThrow();
  });

  it('ALL mode: applies all outstanding, net cash = gross - applied, drawing fully zeroed', async () => {
    drawings = [makeDrawing('d1', 50_000, new Date('2026-01-01'))];

    const result = await service.createSettlement(
      'party-1',
      { safeId: 'safe-a', grossAmount: 300_000, applicationMode: 'ALL' as any },
      'user-1',
    );

    expect(result.appliedAmount).toBe(50_000);
    expect(result.netAmount).toBe(250_000);
    expect(txRows).toHaveLength(1);
    expect(txRows[0].amount).toBe(250_000);
    expect(applications).toHaveLength(1);
    expect(applications[0]).toMatchObject({ drawingId: 'd1', amount: 50_000 });
  });

  it('NONE mode: carries forward — net cash = full gross, drawing left completely untouched, warns', async () => {
    drawings = [makeDrawing('d1', 50_000)];

    const result = await service.createSettlement(
      'party-1',
      { safeId: 'safe-a', grossAmount: 300_000, applicationMode: 'NONE' as any },
      'user-1',
    );

    expect(result.appliedAmount).toBe(0);
    expect(result.netAmount).toBe(300_000);
    expect(applications).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('zero-net settlement (fully covered by applied withdrawals) creates no Transaction', async () => {
    drawings = [makeDrawing('d1', 300_000)];

    const result = await service.createSettlement(
      'party-1',
      { safeId: 'safe-a', grossAmount: 300_000, applicationMode: 'ALL' as any },
      'user-1',
    );

    expect(result.netAmount).toBe(0);
    expect(txRows).toHaveLength(0);
    expect(result.transactionId).toBeNull();
  });

  it('CUSTOM_TOTAL mode: FIFO-consumes the oldest drawing first', async () => {
    drawings = [
      makeDrawing('d1', 50_000, new Date('2026-01-01')),
      makeDrawing('d2', 20_000, new Date('2026-01-05')),
      makeDrawing('d3', 30_000, new Date('2026-01-10')),
    ];

    const result = await service.createSettlement(
      'party-1',
      { safeId: 'safe-a', grossAmount: 300_000, applicationMode: 'CUSTOM_TOTAL' as any, customTotal: 60_000 },
      'user-1',
    );

    expect(result.appliedAmount).toBe(60_000);
    expect(applications.find((a) => a.drawingId === 'd1')?.amount).toBe(50_000);
    expect(applications.find((a) => a.drawingId === 'd2')?.amount).toBe(10_000);
    expect(applications.find((a) => a.drawingId === 'd3')).toBeUndefined();
  });

  it('CUSTOM_TOTAL exceeding total outstanding is capped (not an error), and warns', async () => {
    drawings = [makeDrawing('d1', 50_000)];

    const result = await service.createSettlement(
      'party-1',
      { safeId: 'safe-a', grossAmount: 300_000, applicationMode: 'CUSTOM_TOTAL' as any, customTotal: 1_000_000 },
      'user-1',
    );

    expect(result.appliedAmount).toBe(50_000);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('SPECIFIC mode: applies hand-picked partial amounts across several drawings in one settlement', async () => {
    drawings = [makeDrawing('d1', 50_000), makeDrawing('d2', 20_000), makeDrawing('d3', 30_000)];

    const result = await service.createSettlement(
      'party-1',
      {
        safeId: 'safe-a',
        grossAmount: 300_000,
        applicationMode: 'SPECIFIC' as any,
        specificApplications: [
          { drawingId: 'd1', amount: 20_000 },
          { drawingId: 'd3', amount: 30_000 },
        ],
      },
      'user-1',
    );

    expect(result.appliedAmount).toBe(50_000);
    expect(applications.find((a) => a.drawingId === 'd1')?.amount).toBe(20_000);
    expect(applications.find((a) => a.drawingId === 'd2')).toBeUndefined();
    expect(applications.find((a) => a.drawingId === 'd3')?.amount).toBe(30_000);
  });

  it('SPECIFIC mode: rejects applying more than a single drawing\'s remaining amount', async () => {
    drawings = [makeDrawing('d1', 50_000)];

    await expect(
      service.createSettlement(
        'party-1',
        {
          safeId: 'safe-a',
          grossAmount: 300_000,
          applicationMode: 'SPECIFIC' as any,
          specificApplications: [{ drawingId: 'd1', amount: 60_000 }],
        },
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(applications).toHaveLength(0);
  });

  it('rejects applying more than the settlement gross amount in total', async () => {
    drawings = [makeDrawing('d1', 50_000), makeDrawing('d2', 40_000)];

    await expect(
      service.createSettlement(
        'party-1',
        {
          safeId: 'safe-a',
          grossAmount: 60_000,
          applicationMode: 'SPECIFIC' as any,
          specificApplications: [
            { drawingId: 'd1', amount: 50_000 },
            { drawingId: 'd2', amount: 40_000 },
          ],
        },
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('one withdrawal applied partially across two separate settlements, remaining reduces each time', async () => {
    drawings = [makeDrawing('d1', 100_000)];

    const first = await service.createSettlement(
      'party-1',
      {
        safeId: 'safe-a',
        grossAmount: 500_000,
        applicationMode: 'SPECIFIC' as any,
        specificApplications: [{ drawingId: 'd1', amount: 30_000 }],
      },
      'user-1',
    );
    expect(first.appliedAmount).toBe(30_000);

    const { rows } = await service.getOutstandingDrawings('party-1');
    expect(rows[0].remaining).toBe(70_000);

    const second = await service.createSettlement(
      'party-1',
      {
        safeId: 'safe-a',
        grossAmount: 500_000,
        applicationMode: 'SPECIFIC' as any,
        specificApplications: [{ drawingId: 'd1', amount: 40_000 }],
      },
      'user-1',
    );
    expect(second.appliedAmount).toBe(40_000);

    const { rows: rowsAfter } = await service.getOutstandingDrawings('party-1');
    expect(rowsAfter[0].remaining).toBe(30_000);
    expect(rowsAfter[0].status).toBe('PARTIALLY_APPLIED');
  });

  it('double-submission with the same clientRequestId returns the same settlement, no duplicate Transaction', async () => {
    const prismaMock = makePrisma();
    let existing: any = null;
    (prismaMock.partySettlement.findUnique as jest.Mock).mockImplementation(() => Promise.resolve(existing));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PartiesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: SafesService, useValue: makeSafesServiceMock() },
      ],
    }).compile();
    const idempotentService = module.get(PartiesService);

    drawings = [makeDrawing('d1', 50_000)];
    const first = await idempotentService.createSettlement(
      'party-1',
      { safeId: 'safe-a', grossAmount: 300_000, applicationMode: 'ALL' as any, clientRequestId: 'req-1' },
      'user-1',
    );
    existing = { ...first, applications: [] };

    const second = await idempotentService.createSettlement(
      'party-1',
      { safeId: 'safe-a', grossAmount: 300_000, applicationMode: 'ALL' as any, clientRequestId: 'req-1' },
      'user-1',
    );

    expect(second.id).toBe(first.id);
    expect(txRows).toHaveLength(1); // not duplicated
  });

  it('getOutstandingDrawings() totals match a hand-computed expectation across a mixed history', async () => {
    drawings = [makeDrawing('d1', 50_000), makeDrawing('d2', 20_000), makeDrawing('d3', 30_000)];
    applications = [{ id: 'a1', drawingId: 'd1', settlementId: 's1', amount: 20_000 }];

    const { rows, totalOutstanding } = await service.getOutstandingDrawings('party-1');

    expect(totalOutstanding).toBe(80_000); // (50-20) + 20 + 30
    expect(rows.find((r) => r.id === 'd1')?.remaining).toBe(30_000);
    expect(rows.find((r) => r.id === 'd1')?.status).toBe('PARTIALLY_APPLIED');
    expect(rows.find((r) => r.id === 'd2')?.status).toBe('OPEN');
  });

  it('cancelDrawing() throws when the drawing already has an applied amount', async () => {
    drawings = [makeDrawing('d1', 50_000)];
    applications = [{ id: 'a1', drawingId: 'd1', settlementId: 's1', amount: 10_000 }];

    await expect(service.cancelDrawing('party-1', 'd1', {}, 'user-1')).rejects.toThrow(BadRequestException);
    expect(drawings[0].cancelled).toBe(false);
  });

  it('cancelDrawing() succeeds for a fully-outstanding drawing and sets the cancelled fields', async () => {
    drawings = [makeDrawing('d1', 50_000)];

    const result = await service.cancelDrawing('party-1', 'd1', { note: 'خطأ إدخال' }, 'user-1');

    expect(result.cancelled).toBe(true);
    expect(result.cancelledById).toBe('user-1');
    expect(result.cancelledNote).toBe('خطأ إدخال');
  });
});

/**
 * Phase 34d: statement() — the unified كشف حساب feed. Focused on the
 * trickiest part of this method: a drawing/settlement/deferred-payment's
 * underlying Transaction (which DOES carry partyId) must never ALSO show
 * up as a separate generic TRANSACTION event — that would double-count
 * the same money movement twice in the printed statement.
 */
describe('PartiesService - statement()', () => {
  let service: PartiesService;

  const makePrisma = () => {
    const prisma: any = {
      party: { findUnique: jest.fn(() => Promise.resolve({ id: 'party-1', partyType: 'MERCHANT', active: true })) },
      partyDrawing: {
        findMany: jest.fn(() =>
          Promise.resolve([
            {
              id: 'drawing-1',
              date: new Date('2026-01-02'),
              amount: 500,
              note: 'سحب',
              transactionId: 'tx-drawing-1',
              safe: { id: 'safe-a', name: 'Safe A' },
            },
          ]),
        ),
      },
      partySettlement: {
        findMany: jest.fn(() =>
          Promise.resolve([
            {
              id: 'settlement-1',
              date: new Date('2026-01-03'),
              grossAmount: 1000,
              appliedAmount: 500,
              netAmount: 500,
              note: null,
              transactionId: 'tx-settlement-1',
              safe: { id: 'safe-a', name: 'Safe A' },
            },
          ]),
        ),
      },
      partyDeferred: { findMany: jest.fn(() => Promise.resolve([])) },
      partyDeferredPayment: { findMany: jest.fn(() => Promise.resolve([])) },
      withdrawalApplication: { groupBy: jest.fn(() => Promise.resolve([])) },
      transaction: {
        findMany: jest.fn(({ where }: any) => {
          const all = [
            { id: 'tx-drawing-1', createdAt: new Date('2026-01-02'), amount: 500, kind: 'OUT', description: 'سحب', safe: { id: 'safe-a', name: 'Safe A' }, category: null },
            { id: 'tx-settlement-1', createdAt: new Date('2026-01-03'), amount: 500, kind: 'OUT', description: null, safe: { id: 'safe-a', name: 'Safe A' }, category: null },
            { id: 'tx-plain-1', createdAt: new Date('2026-01-01'), amount: 300, kind: 'IN', description: 'تحصيل', safe: { id: 'safe-a', name: 'Safe A' }, category: { name: 'رواسل' } },
          ];
          const excluded: string[] = where.id?.notIn ?? [];
          return Promise.resolve(all.filter((t) => !excluded.includes(t.id)));
        }),
      },
    };
    return prisma;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PartiesService,
        { provide: PrismaService, useValue: makePrisma() },
        { provide: SafesService, useValue: makeSafesServiceMock() },
      ],
    }).compile();
    service = module.get(PartiesService);
  });

  it('never double-counts a drawing/settlement as both its own event AND a generic transaction', async () => {
    const events = await service.statement('party-1');
    const ids = events.map((e) => e.id);
    // The drawing/settlement each appear exactly once (as DRAWING/SETTLEMENT),
    // and their underlying tx-drawing-1/tx-settlement-1 rows are excluded
    // from the generic TRANSACTION set — only tx-plain-1 (no side-table
    // counterpart) shows up as a plain TRANSACTION event.
    expect(ids).toEqual(expect.arrayContaining(['drawing-1', 'settlement-1', 'tx-plain-1']));
    expect(ids).not.toContain('tx-drawing-1');
    expect(ids).not.toContain('tx-settlement-1');
    expect(events).toHaveLength(3);
  });

  it('sorts events chronologically descending across all mixed types', async () => {
    const events = await service.statement('party-1');
    const dates = events.map((e) => +new Date(e.date));
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it('never combines a DRAWING amount with a SETTLEMENT amount into one event', async () => {
    const events = await service.statement('party-1');
    const drawing = events.find((e) => e.type === 'DRAWING')!;
    const settlement = events.find((e) => e.type === 'SETTLEMENT')!;
    expect(drawing.amount).toBe(500);
    expect(settlement.amount).toBe(500);
    // Each event's amount is independently exactly what was posted — no
    // subtraction/netting has been applied across the two.
  });
});

describe('PartiesService - getOutstandingDeferredSummary()', () => {
  it('sums remainingAmount per party, excludes fully-settled rows, and respects partyType', async () => {
    const prisma: any = {
      party: {
        findMany: jest.fn(() => Promise.resolve([{ id: 'agent-1' }, { id: 'agent-2' }])),
      },
      partyDeferred: {
        findMany: jest.fn(() =>
          Promise.resolve([
            { partyId: 'agent-1', remainingAmount: 300, createdAt: new Date('2026-01-01') },
            { partyId: 'agent-1', remainingAmount: 200, createdAt: new Date('2026-01-05') },
          ]),
        ),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PartiesService,
        { provide: PrismaService, useValue: prisma },
        { provide: SafesService, useValue: makeSafesServiceMock() },
      ],
    }).compile();
    const service = module.get(PartiesService);

    const result = await service.getOutstandingDeferredSummary('AGENT');

    expect(prisma.party.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ partyType: 'AGENT' }) }),
    );
    expect(result).toEqual([
      { partyId: 'agent-1', outstandingTotal: 500, count: 2, lastDate: new Date('2026-01-05') },
    ]);
    // agent-2 has zero open deferred rows — correctly absent, not a zero row.
    expect(result.find((r) => r.partyId === 'agent-2')).toBeUndefined();
  });
});

describe('PartiesService - statement() remaining/settled per event', () => {
  it('DRAWING carries its own remaining/settled; DEFERRED/DEFERRED_PAYMENT carry the deferred record\'s current remaining/settled', async () => {
    const prisma: any = {
      party: { findUnique: jest.fn(() => Promise.resolve({ id: 'party-1', partyType: 'MERCHANT', active: true })) },
      partyDrawing: {
        findMany: jest.fn(() =>
          Promise.resolve([{ id: 'drawing-1', date: new Date(), amount: 1000, note: null, transactionId: null, safe: null }]),
        ),
      },
      withdrawalApplication: {
        groupBy: jest.fn(() => Promise.resolve([{ drawingId: 'drawing-1', _sum: { amount: 400 } }])),
      },
      partySettlement: { findMany: jest.fn(() => Promise.resolve([])) },
      partyDeferred: {
        findMany: jest.fn(() =>
          Promise.resolve([{ id: 'deferred-1', createdAt: new Date(), originalAmount: 500, remainingAmount: 200 }]),
        ),
      },
      partyDeferredPayment: {
        findMany: jest.fn(() =>
          Promise.resolve([
            {
              id: 'payment-1',
              date: new Date(),
              amount: 300,
              transactionId: null,
              safe: null,
              deferred: { id: 'deferred-1', remainingAmount: 200 },
            },
          ]),
        ),
      },
      transaction: { findMany: jest.fn(() => Promise.resolve([])) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PartiesService,
        { provide: PrismaService, useValue: prisma },
        { provide: SafesService, useValue: makeSafesServiceMock() },
      ],
    }).compile();
    const service = module.get(PartiesService);

    const events = await service.statement('party-1');

    expect(events.find((e) => e.type === 'DRAWING')).toMatchObject({ remaining: 600, settled: false });
    expect(events.find((e) => e.type === 'DEFERRED')).toMatchObject({ remaining: 200, settled: false });
    expect(events.find((e) => e.type === 'DEFERRED_PAYMENT')).toMatchObject({ remaining: 200, settled: false });
  });
});
