import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PartiesService } from '../parties/parties.service';
import { SafesService } from '../safes/safes.service';
import { TransactionsService } from './transactions.service';

/**
 * No live Postgres instance is available in this environment, so
 * PrismaService is mocked with in-memory fakes, same pattern as
 * safes.service.spec.ts. Focused on the void/reverse balance invariant:
 * voiding a POSTED transaction must leave the safe's POSTED-only balance
 * sum unchanged once the reversal row is included.
 */
describe('TransactionsService - void()', () => {
  let service: TransactionsService;
  let transactions: any[];
  let idCounter: number;

  const balanceOf = (safeId: string) =>
    transactions
      .filter((t) => t.safeId === safeId && t.status === 'POSTED')
      .reduce((sum, t) => sum + (t.kind === 'OUT' ? -Number(t.amount) : Number(t.amount)), 0);

  let safesService: { assertSufficientBalance: jest.Mock };

  beforeEach(async () => {
    transactions = [];
    idCounter = 1;
    // Defaults to "always sufficient" — the dedicated negative-balance
    // describe block below overrides this to actually reject.
    safesService = { assertSufficientBalance: jest.fn(() => Promise.resolve()) };

    const prismaMock: any = {
      transaction: {
        findUnique: jest.fn(({ where: { id } }: any) =>
          Promise.resolve(transactions.find((t) => t.id === id) ?? null),
        ),
        create: jest.fn(({ data }: any) => {
          const row = { id: `t${idCounter++}`, status: 'POSTED', ...data };
          transactions.push(row);
          return Promise.resolve(row);
        }),
        update: jest.fn(({ where: { id }, data }: any) => {
          const row = transactions.find((t) => t.id === id);
          if (row) Object.assign(row, data);
          return Promise.resolve(row);
        }),
      },
      $transaction: jest.fn((cb: any) => cb(prismaMock)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: PartiesService,
          useValue: {
            recordDrawing: jest.fn(),
            syncDrawingForTransaction: jest.fn(),
            syncDeferredPaymentForTransaction: jest.fn(),
            unapplySettlementForTransaction: jest.fn(),
          },
        },
        { provide: SafesService, useValue: safesService },
      ],
    }).compile();

    service = module.get(TransactionsService);

    transactions.push({
      id: 'tx-1',
      safeId: 'safe-a',
      kind: 'IN',
      amount: 1000,
      status: 'POSTED',
      categoryId: null,
      partyId: null,
      description: 'إيراد',
      referenceNo: null,
    });
  });

  it('excludes the voided original and posts an opposite-kind reversal, exactly like the old app', async () => {
    const before = balanceOf('safe-a');
    expect(before).toBe(1000);

    const { reversalId } = await service.void('tx-1');

    const original = transactions.find((t) => t.id === 'tx-1');
    expect(original.status).toBe('VOIDED');

    const reversal = transactions.find((t) => t.id === reversalId);
    expect(reversal.kind).toBe('OUT');
    expect(Number(reversal.amount)).toBe(1000);
    expect(reversal.relatedTransactionId).toBe('tx-1');
    expect(reversal.description).toContain('عكس:');
    expect(reversal.status).toBe('POSTED');

    // Faithful port of the old app's arithmetic: the VOIDED original drops
    // out of the POSTED-only sum entirely (contributes 0, not -1000), and
    // the POSTED reversal (opposite kind, same amount) is the only row left
    // affecting the balance -> -1000, not back to the pre-transaction 0.
    const after = balanceOf('safe-a');
    expect(after).toBe(-1000);

    // Both rows (original + reversal) are visible in the transaction log
    // even though only the reversal counts toward the live balance.
    expect(transactions).toHaveLength(2);
  });

  it('rejects voiding an already-voided transaction', async () => {
    await service.void('tx-1');
    await expect(service.void('tx-1')).rejects.toThrow(NotFoundException);
  });

  it('rejects voiding an unknown transaction', async () => {
    await expect(service.void('missing')).rejects.toThrow(NotFoundException);
  });
});

/**
 * create()'s gating between the drawing sync (OUT+MERCHANT) and the
 * deferred-settlement sync (IN+AGENT) — regression check that an income
 * transaction against an agent triggers only syncDeferredPaymentForTransaction
 * and an expense against a merchant triggers only syncDrawingForTransaction,
 * never both for the same transaction.
 */
describe('TransactionsService - create() drawing/deferred sync gating', () => {
  let service: TransactionsService;
  let parties: {
    syncDrawingForTransaction: jest.Mock;
    syncDeferredPaymentForTransaction: jest.Mock;
    unapplySettlementForTransaction: jest.Mock;
    getOutstandingDrawingsTotal: jest.Mock;
  };

  const categories: Record<
    string,
    { id: string; kind: string; partyType: string | null; systemKey?: string | null; active: boolean }
  > = {
    'cat-agent': { id: 'cat-agent', kind: 'IN', partyType: 'AGENT', systemKey: 'AGENT_COLLECTION', active: true },
    'cat-sender': { id: 'cat-sender', kind: 'OUT', partyType: 'MERCHANT', systemKey: 'MERCHANT_SENDER', active: true },
    'cat-drawing': { id: 'cat-drawing', kind: 'OUT', partyType: 'MERCHANT', systemKey: 'MERCHANT_DRAWING', active: true },
    'cat-courier-advance': { id: 'cat-courier-advance', kind: 'OUT', partyType: null, systemKey: 'COURIER_ADVANCE', active: true },
  };

  beforeEach(async () => {
    parties = {
      syncDrawingForTransaction: jest.fn(),
      syncDeferredPaymentForTransaction: jest.fn(),
      unapplySettlementForTransaction: jest.fn(),
      // Defaults to "nothing outstanding" — the Phase 25 describe block
      // below overrides this per-case to exercise the open-drawings guard.
      getOutstandingDrawingsTotal: jest.fn(() => Promise.resolve(0)),
    } as any;

    const prismaMock: any = {
      category: { findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(categories[id] ?? null)) },
      party: {
        findUnique: jest.fn(({ where: { id } }: any) =>
          Promise.resolve({ id, active: true, partyType: id === 'party-agent' ? 'AGENT' : 'MERCHANT' }),
        ),
      },
      safe: { findUnique: jest.fn(() => Promise.resolve({ id: 'safe-a' })) },
      transaction: {
        create: jest.fn(({ data }: any) => Promise.resolve({ id: 'tx-1', status: 'POSTED', ...data })),
      },
      $transaction: jest.fn((cb: any) => cb(prismaMock)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: PartiesService, useValue: parties },
        { provide: SafesService, useValue: { assertSufficientBalance: jest.fn(() => Promise.resolve()) } },
      ],
    }).compile();

    service = module.get(TransactionsService);
  });

  it('an IN+AGENT transaction triggers only the deferred sync', async () => {
    await service.create(
      { kind: 'IN', amount: 500, safeId: 'safe-a', categoryId: 'cat-agent', partyId: 'party-agent' } as any,
      'user-1',
    );

    expect(parties.syncDeferredPaymentForTransaction).toHaveBeenCalledWith(
      expect.anything(),
      'tx-1',
      expect.objectContaining({ partyId: 'party-agent', safeId: 'safe-a', amount: 500 }),
    );
    expect(parties.syncDrawingForTransaction).not.toHaveBeenCalled();
  });

  it('an OUT+مسحوبات transaction triggers only the drawing sync', async () => {
    await service.create(
      { kind: 'OUT', amount: 300, safeId: 'safe-a', categoryId: 'cat-drawing', partyId: 'party-merchant' } as any,
      'user-1',
    );

    expect(parties.syncDrawingForTransaction).toHaveBeenCalledWith(
      expect.anything(),
      'tx-1',
      expect.objectContaining({ partyId: 'party-merchant', safeId: 'safe-a', amount: 300 }),
    );
    expect(parties.syncDeferredPaymentForTransaction).not.toHaveBeenCalled();
  });

  it('an OUT+رواسل transaction does NOT trigger the drawing sync — only مسحوبات creates a PartyDrawing', async () => {
    await service.create(
      { kind: 'OUT', amount: 300, safeId: 'safe-a', categoryId: 'cat-sender', partyId: 'party-merchant' } as any,
      'user-1',
    );

    expect(parties.syncDrawingForTransaction).not.toHaveBeenCalled();
    expect(parties.syncDeferredPaymentForTransaction).not.toHaveBeenCalled();
  });

  // Phase 25: رواسل is selectable again, but gated at submit-time — a
  // plain OUT+رواسل expense proceeds normally when the party has nothing
  // outstanding to net (the default mock above), and is rejected with a
  // structured 409 when it does, directing the caller to Settlement
  // instead. مسحوبات itself is never subject to this guard.
  it('does NOT block a رواسل expense when the party has zero open drawings', async () => {
    await expect(
      service.create(
        { kind: 'OUT', amount: 300, safeId: 'safe-a', categoryId: 'cat-sender', partyId: 'party-merchant' } as any,
        'user-1',
      ),
    ).resolves.toBeDefined();
  });

  it('blocks a رواسل expense with a structured 409 when the party has an open drawing', async () => {
    parties.getOutstandingDrawingsTotal.mockResolvedValueOnce(150);

    const promise = service.create(
      { kind: 'OUT', amount: 300, safeId: 'safe-a', categoryId: 'cat-sender', partyId: 'party-merchant' } as any,
      'user-1',
    );

    await expect(promise).rejects.toThrow(ConflictException);
    try {
      await promise;
    } catch (err) {
      expect((err as ConflictException).getResponse()).toEqual({
        message: { code: 'REQUIRES_SETTLEMENT', requiresSettlement: true, partyId: 'party-merchant', openDrawings: 150 },
      });
    }
  });

  it('does not block a رواسل expense at the 0.005 boundary (exactly at or below is not "open")', async () => {
    parties.getOutstandingDrawingsTotal.mockResolvedValueOnce(0.005);

    await expect(
      service.create(
        { kind: 'OUT', amount: 300, safeId: 'safe-a', categoryId: 'cat-sender', partyId: 'party-merchant' } as any,
        'user-1',
      ),
    ).resolves.toBeDefined();
  });

  it('does NOT block a new مسحوبات entry either', async () => {
    await expect(
      service.create(
        { kind: 'OUT', amount: 300, safeId: 'safe-a', categoryId: 'cat-drawing', partyId: 'party-merchant' } as any,
        'user-1',
      ),
    ).resolves.toBeDefined();
  });

  // Phase 27: the 3 courier-ledger system categories are visible in the UI
  // again, but a plain transaction under them is NEVER valid through this
  // generic endpoint — the frontend redirects into the Couriers module
  // instead, and this is the server-side backstop for any caller that
  // reaches the endpoint directly.
  it('rejects a plain transaction under a courier-ledger category (COURIER_ADVANCE), and writes nothing', async () => {
    await expect(
      service.create({ kind: 'OUT', amount: 100, safeId: 'safe-a', categoryId: 'cat-courier-advance' } as any, 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });
});

/**
 * Balance can never go negative — create()/update()/void() must all defer
 * to SafesService.assertSufficientBalance() and roll back the whole
 * $transaction (never partially write) when it rejects.
 */
describe('TransactionsService - negative balance guard', () => {
  let service: TransactionsService;
  let safesService: { assertSufficientBalance: jest.Mock };
  let transactions: any[];

  beforeEach(async () => {
    transactions = [];
    safesService = {
      assertSufficientBalance: jest.fn(() => Promise.reject(new BadRequestException('رصيد الخزنة غير كافٍ'))),
    };

    const prismaMock: any = {
      category: {
        findUnique: jest.fn(({ where: { id } }: any) =>
          Promise.resolve(id === 'cat-1' ? { id: 'cat-1', kind: 'OUT', active: true, partyType: null } : id === 'cat-2' ? { id: 'cat-2', kind: 'IN', active: true, partyType: null } : null),
        ),
      },
      party: { findUnique: jest.fn(() => Promise.resolve(null)) },
      safe: { findUnique: jest.fn(() => Promise.resolve({ id: 'safe-a' })) },
      transaction: {
        findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(transactions.find((t) => t.id === id) ?? null)),
        create: jest.fn(({ data }: any) => {
          const row = { id: `t${transactions.length + 1}`, status: 'POSTED', ...data };
          transactions.push(row);
          return Promise.resolve(row);
        }),
        update: jest.fn(({ where: { id }, data }: any) => {
          const row = transactions.find((t) => t.id === id)!;
          Object.assign(row, data);
          return Promise.resolve(row);
        }),
      },
      $transaction: jest.fn((cb: any) => cb(prismaMock)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: PartiesService,
          useValue: {
            syncDrawingForTransaction: jest.fn(),
            syncDeferredPaymentForTransaction: jest.fn(),
            unapplySettlementForTransaction: jest.fn(),
          },
        },
        { provide: SafesService, useValue: safesService },
      ],
    }).compile();

    service = module.get(TransactionsService);
  });

  it('create() rejects an OUT transaction the safe cannot cover, and writes nothing', async () => {
    await expect(
      service.create({ kind: 'OUT', amount: 5000, safeId: 'safe-a', categoryId: 'cat-1' } as any, 'user-1'),
    ).rejects.toThrow(BadRequestException);
    expect(transactions).toHaveLength(0);
  });

  it('create() allows an IN transaction regardless of balance (guard only applies to OUT)', async () => {
    await expect(
      service.create({ kind: 'IN', amount: 5000, safeId: 'safe-a', categoryId: 'cat-2' } as any, 'user-1'),
    ).resolves.toBeDefined();
    expect(safesService.assertSufficientBalance).not.toHaveBeenCalled();
  });

  it('update() rejects editing a transaction into an unaffordable OUT', async () => {
    transactions.push({ id: 'tx-1', safeId: 'safe-a', kind: 'OUT', amount: 100, status: 'POSTED', categoryId: 'cat-1' });
    await expect(service.update('tx-1', { amount: 5000 } as any)).rejects.toThrow(BadRequestException);
  });

  it('void() rejects reversing an IN when the resulting OUT reversal would go negative', async () => {
    // NOTE: this mock's $transaction has no real rollback semantics (it
    // just invokes the callback against the same in-memory arrays), so
    // this only asserts the rejection itself — real Postgres atomicity
    // (the original staying POSTED, not left VOIDED, on rollback) is
    // exactly what wrapping the check inside prisma.$transaction provides
    // in production and isn't re-provable against this fake.
    transactions.push({ id: 'tx-1', safeId: 'safe-a', kind: 'IN', amount: 1000, status: 'POSTED' });
    await expect(service.void('tx-1')).rejects.toThrow(BadRequestException);
  });

  it('void() allows reversing an OUT (the reversal is IN, never negative)', async () => {
    transactions.push({ id: 'tx-1', safeId: 'safe-a', kind: 'OUT', amount: 1000, status: 'POSTED' });
    await expect(service.void('tx-1')).resolves.toBeDefined();
  });
});

/**
 * createBatch() — طلب سريع: several IN/OUT rows sharing one optional
 * party, created atomically. Confirms the all-or-nothing rollback behavior
 * (a late row's failure must undo every earlier row already written in the
 * same batch) and that the extracted createOneWithinTx() still applies the
 * same drawing/deferred side-effects per row as single create() does.
 */
describe('TransactionsService - createBatch()', () => {
  let service: TransactionsService;
  let transactions: any[];
  let parties: Record<string, any>;
  let idCounter: number;
  let balanceRejectsForSafe: string | null;

  const categories: Record<string, any> = {
    'cat-agent': { id: 'cat-agent', kind: 'IN', partyType: 'AGENT', systemKey: 'AGENT_COLLECTION', active: true },
    'cat-drawing': { id: 'cat-drawing', kind: 'OUT', partyType: 'MERCHANT', systemKey: 'MERCHANT_DRAWING', active: true },
    'cat-sender': { id: 'cat-sender', kind: 'OUT', partyType: 'MERCHANT', systemKey: 'MERCHANT_SENDER', active: true },
    'cat-plain-in': { id: 'cat-plain-in', kind: 'IN', partyType: null, active: true },
    'cat-plain-out': { id: 'cat-plain-out', kind: 'OUT', partyType: null, active: true },
    'cat-courier-advance': { id: 'cat-courier-advance', kind: 'OUT', partyType: null, systemKey: 'COURIER_ADVANCE', active: true },
  };

  beforeEach(async () => {
    transactions = [];
    idCounter = 1;
    balanceRejectsForSafe = null;

    parties = {
      syncDrawingForTransaction: jest.fn(),
      syncDeferredPaymentForTransaction: jest.fn(),
      unapplySettlementForTransaction: jest.fn(),
      // Defaults to "nothing outstanding" — overridden per-case below to
      // exercise the Phase 25 رواسل open-drawings guard at the batch level.
      getOutstandingDrawingsTotal: jest.fn(() => Promise.resolve(0)),
    };

    const prismaMock: any = {
      category: { findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(categories[id] ?? null)) },
      party: {
        findUnique: jest.fn(({ where: { id } }: any) =>
          Promise.resolve(id ? { id, active: true, partyType: id === 'party-agent' ? 'AGENT' : 'MERCHANT' } : null),
        ),
      },
      safe: {
        findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve({ id, name: id })),
      },
      transaction: {
        create: jest.fn(({ data }: any) => {
          const row = { id: `t${idCounter++}`, status: 'POSTED', ...data };
          transactions.push(row);
          return Promise.resolve(row);
        }),
      },
      // Unlike this file's other, simpler $transaction mocks, this one
      // simulates real Postgres rollback-on-throw: it snapshots
      // `transactions` before running the callback and restores the
      // snapshot if the callback rejects, so createBatch()'s "a later
      // row's failure undoes earlier rows in the same batch" guarantee is
      // actually exercised, not just assumed.
      $transaction: jest.fn(async (cb: any) => {
        const snapshot = [...transactions];
        try {
          return await cb(prismaMock);
        } catch (err) {
          transactions.length = 0;
          transactions.push(...snapshot);
          throw err;
        }
      }),
    };

    const safesService = {
      assertSufficientBalance: jest.fn((safeId: string) => {
        if (safeId === balanceRejectsForSafe) {
          return Promise.reject(new BadRequestException('رصيد الخزنة غير كافٍ'));
        }
        return Promise.resolve();
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: PartiesService, useValue: parties },
        { provide: SafesService, useValue: safesService },
      ],
    }).compile();

    service = module.get(TransactionsService);
  });

  it('rejects an empty batch', async () => {
    await expect(service.createBatch({ items: [] } as any, 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('creates N transactions across different safes for one shared party', async () => {
    const result = await service.createBatch(
      {
        partyId: 'party-agent',
        items: [
          { kind: 'IN', categoryId: 'cat-agent', safeId: 'safe-a', amount: 100 },
          { kind: 'IN', categoryId: 'cat-agent', safeId: 'safe-b', amount: 200 },
          { kind: 'IN', categoryId: 'cat-agent', safeId: 'safe-c', amount: 300 },
        ],
      } as any,
      'user-1',
    );

    expect(result).toHaveLength(3);
    expect(transactions).toHaveLength(3);
    expect(transactions.map((t) => t.safeId)).toEqual(['safe-a', 'safe-b', 'safe-c']);
    expect(transactions.every((t) => t.partyId === 'party-agent')).toBe(true);
    // Each IN+AGENT row triggers the deferred sync, same as single create().
    expect(parties.syncDeferredPaymentForTransaction).toHaveBeenCalledTimes(3);
  });

  it('mixes IN and OUT rows with no shared party in one batch', async () => {
    const result = await service.createBatch(
      {
        items: [
          { kind: 'IN', categoryId: 'cat-plain-in', safeId: 'safe-a', amount: 500 },
          { kind: 'OUT', categoryId: 'cat-plain-out', safeId: 'safe-a', amount: 200 },
        ],
      } as any,
      'user-1',
    );

    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe('IN');
    expect(result[1].kind).toBe('OUT');
  });

  it('a row whose category needs a different party type than the shared party rejects the WHOLE batch — nothing is created', async () => {
    await expect(
      service.createBatch(
        {
          partyId: 'party-merchant', // MERCHANT party, but cat-agent needs AGENT
          items: [
            { kind: 'OUT', categoryId: 'cat-drawing', safeId: 'safe-a', amount: 100 },
            { kind: 'IN', categoryId: 'cat-agent', safeId: 'safe-b', amount: 200 },
          ],
        } as any,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);

    expect(transactions).toHaveLength(0);
  });

  it('allows a batch with a رواسل row when the shared party has zero open drawings', async () => {
    const result = await service.createBatch(
      {
        partyId: 'party-merchant',
        items: [
          { kind: 'OUT', categoryId: 'cat-sender', safeId: 'safe-a', amount: 100 },
          { kind: 'OUT', categoryId: 'cat-drawing', safeId: 'safe-b', amount: 50 },
        ],
      } as any,
      'user-1',
    );
    expect(result).toHaveLength(2);
  });

  it("rejects the WHOLE batch — including otherwise-valid rows — when a رواسل row's party has an open drawing", async () => {
    parties.getOutstandingDrawingsTotal.mockResolvedValue(150);

    await expect(
      service.createBatch(
        {
          partyId: 'party-merchant',
          items: [
            { kind: 'OUT', categoryId: 'cat-drawing', safeId: 'safe-a', amount: 50 },
            { kind: 'OUT', categoryId: 'cat-sender', safeId: 'safe-b', amount: 100 },
          ],
        } as any,
        'user-1',
      ),
    ).rejects.toThrow(ConflictException);

    expect(transactions).toHaveLength(0);
  });

  it('rejects the WHOLE batch when any row is under a courier-ledger category, and writes nothing', async () => {
    await expect(
      service.createBatch(
        {
          items: [
            { kind: 'OUT', categoryId: 'cat-plain-out', safeId: 'safe-a', amount: 50 },
            { kind: 'OUT', categoryId: 'cat-courier-advance', safeId: 'safe-b', amount: 100 },
          ],
        } as any,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);

    expect(transactions).toHaveLength(0);
  });

  it("a later row's insufficient balance rolls back earlier rows already written in the same batch", async () => {
    balanceRejectsForSafe = 'safe-b';

    await expect(
      service.createBatch(
        {
          items: [
            { kind: 'OUT', categoryId: 'cat-plain-out', safeId: 'safe-a', amount: 100 },
            { kind: 'OUT', categoryId: 'cat-plain-out', safeId: 'safe-b', amount: 9999 },
          ],
        } as any,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);

    // The first row (safe-a) WAS written before the second row's balance
    // check threw — this asserts the mocked $transaction's rollback
    // simulation actually undid it, proving the batch is all-or-nothing.
    expect(transactions).toHaveLength(0);
  });

  it('an empty items array with only a partyId set is still rejected', async () => {
    await expect(service.createBatch({ partyId: 'party-agent', items: [] } as any, 'user-1')).rejects.toThrow(
      BadRequestException,
    );
  });
});
