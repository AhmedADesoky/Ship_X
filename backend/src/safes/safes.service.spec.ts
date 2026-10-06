import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SafesService } from './safes.service';

/**
 * NOTE: No live Postgres instance is available in this environment, so
 * PrismaService is fully mocked here (in-memory fakes for safe/transaction
 * tables, and a $transaction implementation that just runs the callback
 * against the same mocked `tx` client). This tests the transfer logic and
 * invariant, not real Postgres transactional semantics.
 */
describe('SafesService - transfer()', () => {
  let service: SafesService;
  let transactions: Array<{ id: string; safeId: string; kind: string; amount: any; relatedTransactionId?: string | null }>;
  let safes: Array<{ id: string; name: string }>;
  let idCounter: number;

  const makePrismaMock = () => {
    const tx = {
      safe: {
        findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(safes.find((s) => s.id === id) ?? null)),
      },
      transaction: {
        create: jest.fn(({ data }: any) => {
          const row = { id: `t${idCounter++}`, relatedTransactionId: null, ...data };
          transactions.push(row);
          return Promise.resolve(row);
        }),
        update: jest.fn(({ where: { id }, data }: any) => {
          const row = transactions.find((t) => t.id === id);
          if (row) Object.assign(row, data);
          return Promise.resolve(row);
        }),
        findMany: jest.fn(({ where: { safeId, status } }: any) =>
          Promise.resolve(
            transactions
              .filter((t) => t.safeId === safeId && (!status || (t as any).status !== 'VOIDED'))
              .map((t) => ({ kind: t.kind, amount: t.amount })),
          ),
        ),
        aggregate: jest.fn(({ where }: any) => {
          const matches = transactions.filter(
            (t) =>
              (!where.safeId || t.safeId === where.safeId) &&
              (where.kind === undefined ||
                (typeof where.kind === 'object' ? t.kind !== where.kind.not : t.kind === where.kind)),
          );
          const sum = matches.reduce((s, t) => s + Number(t.amount), 0);
          return Promise.resolve({ _sum: { amount: matches.length ? sum : null } });
        }),
      },
    };

    return {
      $transaction: jest.fn((cb: any) => cb(tx)),
      safe: {
        findUnique: tx.safe.findUnique,
        findMany: jest.fn(() => Promise.resolve(safes)),
      },
      transaction: tx.transaction,
    };
  };

  let prismaMock: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    transactions = [];
    idCounter = 1;
    safes = [
      { id: 'safe-a', name: 'Safe A', openingBalance: 500 } as any,
      { id: 'safe-b', name: 'Safe B', openingBalance: 0 } as any,
    ];
    prismaMock = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [SafesService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get(SafesService);
  });

  it('creates two linked legs and preserves total balance across both safes', async () => {
    const balanceBeforeA = await service.getBalance('safe-a');
    const balanceBeforeB = await service.getBalance('safe-b');
    expect(balanceBeforeA + balanceBeforeB).toBe(500);

    await service.transfer({ fromSafeId: 'safe-a', toSafeId: 'safe-b', amount: 500 }, 'user-1');

    const balanceAfterA = await service.getBalance('safe-a');
    const balanceAfterB = await service.getBalance('safe-b');

    expect(balanceAfterA).toBe(0);
    expect(balanceAfterB).toBe(500);
    // The core invariant: total company balance across both legs is unchanged.
    expect(balanceAfterA + balanceAfterB).toBe(balanceBeforeA + balanceBeforeB);

    expect(transactions).toHaveLength(2);
    const [outLeg, inLeg] = transactions;
    expect(outLeg.relatedTransactionId).toBe(inLeg.id);
  });

  it('rejects a transfer between a safe and itself', async () => {
    await expect(
      service.transfer({ fromSafeId: 'safe-a', toSafeId: 'safe-a', amount: 100 }, 'user-1'),
    ).rejects.toThrow();
  });

  it('rejects a transfer referencing an unknown safe', async () => {
    await expect(
      service.transfer({ fromSafeId: 'safe-a', toSafeId: 'missing-safe', amount: 100 }, 'user-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a transfer that would leave the source safe negative, and writes nothing', async () => {
    await expect(
      service.transfer({ fromSafeId: 'safe-a', toSafeId: 'safe-b', amount: 5000 }, 'user-1'),
    ).rejects.toThrow(BadRequestException);
    expect(transactions).toHaveLength(0);
  });

  it('getBalances() computes every safe balance via one groupBy instead of N getBalance() calls', async () => {
    await service.transfer({ fromSafeId: 'safe-a', toSafeId: 'safe-b', amount: 300 }, 'user-1');

    (prismaMock as any).transaction.groupBy = jest.fn(({ where }: any) => {
      const ids: string[] = where.safeId.in;
      const groups = new Map<string, number>();
      for (const t of transactions) {
        if (!ids.includes(t.safeId)) continue;
        const key = `${t.safeId}:${t.kind}`;
        groups.set(key, (groups.get(key) ?? 0) + Number(t.amount));
      }
      return Promise.resolve(
        [...groups.entries()].map(([key, sum]) => {
          const [safeId, kind] = key.split(':');
          return { safeId, kind, _sum: { amount: sum } };
        }),
      );
    });

    const balances = await service.getBalances();
    const byId = Object.fromEntries(balances.map((b) => [b.id, b.balance]));
    // safe-a starts this describe block's tests at openingBalance 500.
    expect(byId['safe-a']).toBe(200);
    expect(byId['safe-b']).toBe(300);
  });
});

describe('SafesService - adjustBalance()', () => {
  let service: SafesService;
  let transactions: Array<{ id: string; safeId: string; kind: string; amount: any; status?: string }>;
  let safes: Array<{ id: string; name: string; openingBalance: any }>;
  let idCounter: number;

  const makePrismaMock = () => {
    const tx = {
      safe: {
        findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(safes.find((s) => s.id === id) ?? null)),
      },
      transaction: {
        create: jest.fn(({ data }: any) => {
          const row = { id: `t${idCounter++}`, status: 'POSTED', ...data };
          transactions.push(row);
          return Promise.resolve(row);
        }),
        findMany: jest.fn(({ where: { safeId, status } }: any) =>
          Promise.resolve(
            transactions
              .filter((t) => t.safeId === safeId && (!status || t.status === status))
              .map((t) => ({ kind: t.kind, amount: t.amount })),
          ),
        ),
        aggregate: jest.fn(({ where }: any) => {
          const matches = transactions.filter(
            (t) =>
              (!where.safeId || t.safeId === where.safeId) &&
              (!where.status || t.status === where.status) &&
              (where.kind === undefined ||
                (typeof where.kind === 'object' ? t.kind !== where.kind.not : t.kind === where.kind)),
          );
          const sum = matches.reduce((s, t) => s + Number(t.amount), 0);
          return Promise.resolve({ _sum: { amount: matches.length ? sum : null } });
        }),
      },
    };

    return {
      $transaction: jest.fn((cb: any) => cb(tx)),
      safe: { findUnique: tx.safe.findUnique },
      transaction: tx.transaction,
    };
  };

  let prismaMock: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    transactions = [];
    idCounter = 1;
    safes = [{ id: 'safe-a', name: 'Safe A', openingBalance: 100 }];
    prismaMock = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [SafesService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get(SafesService);
  });

  it('creates an IN transaction when target balance is higher than current', async () => {
    const result = await service.adjustBalance('safe-a', { targetBalance: 300 }, 'user-1');

    expect(result.balance).toBe(300);
    expect(result.transaction).not.toBeNull();
    expect(result.transaction!.kind).toBe('IN');
    expect(Number(result.transaction!.amount)).toBe(200);
    expect(result.transaction!.description).toBe('تسوية رصيد يدوي');
  });

  it('creates an OUT transaction when target balance is lower than current, and includes the note', async () => {
    const result = await service.adjustBalance('safe-a', { targetBalance: 40, note: 'جرد نهاية الشهر' }, 'user-1');

    expect(result.balance).toBe(40);
    expect(result.transaction!.kind).toBe('OUT');
    expect(Number(result.transaction!.amount)).toBe(60);
    expect(result.transaction!.description).toBe('تسوية رصيد يدوي: جرد نهاية الشهر');
  });

  it('is a no-op when target balance equals current balance', async () => {
    const result = await service.adjustBalance('safe-a', { targetBalance: 100 }, 'user-1');

    expect(result.transaction).toBeNull();
    expect(result.balance).toBe(100);
    expect(transactions).toHaveLength(0);
  });

  it('throws NotFoundException for an unknown safe', async () => {
    await expect(
      service.adjustBalance('missing-safe', { targetBalance: 100 }, 'user-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a negative target balance outright', async () => {
    await expect(
      service.adjustBalance('safe-a', { targetBalance: -50 }, 'user-1'),
    ).rejects.toThrow(BadRequestException);
    expect(transactions).toHaveLength(0);
  });
});

describe('SafesService - deposit() / remove()', () => {
  let service: SafesService;
  let transactions: Array<{ id: string; safeId: string; kind: string; amount: any; status?: string }>;
  let safes: Array<{ id: string; name: string; openingBalance: any; active: boolean }>;
  let idCounter: number;

  const makePrismaMock = () => ({
    safe: {
      findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(safes.find((s) => s.id === id) ?? null)),
      update: jest.fn(({ where: { id }, data }: any) => {
        const safe = safes.find((s) => s.id === id)!;
        Object.assign(safe, data);
        return Promise.resolve(safe);
      }),
    },
    transaction: {
      create: jest.fn(({ data }: any) => {
        const row = { id: `t${idCounter++}`, status: 'POSTED', ...data };
        transactions.push(row);
        return Promise.resolve(row);
      }),
      findMany: jest.fn(({ where: { safeId, status } }: any) =>
        Promise.resolve(
          transactions
            .filter((t) => t.safeId === safeId && (!status || t.status === status))
            .map((t) => ({ kind: t.kind, amount: t.amount })),
        ),
      ),
      aggregate: jest.fn(({ where }: any) => {
        const matches = transactions.filter(
          (t) =>
            (!where.safeId || t.safeId === where.safeId) &&
            (!where.status || t.status === where.status) &&
            (where.kind === undefined ||
              (typeof where.kind === 'object' ? t.kind !== where.kind.not : t.kind === where.kind)),
        );
        const sum = matches.reduce((s, t) => s + Number(t.amount), 0);
        return Promise.resolve({ _sum: { amount: matches.length ? sum : null } });
      }),
    },
  });

  beforeEach(async () => {
    transactions = [];
    idCounter = 1;
    safes = [{ id: 'safe-a', name: 'Safe A', openingBalance: 100, active: true }];

    const module: TestingModule = await Test.createTestingModule({
      providers: [SafesService, { provide: PrismaService, useValue: makePrismaMock() }],
    }).compile();

    service = module.get(SafesService);
  });

  it('deposit() posts a plain IN transaction without reading the current balance first', async () => {
    const result = await service.deposit('safe-a', { amount: 250 }, 'user-1');

    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ kind: 'IN', amount: 250, safeId: 'safe-a' });
    expect(result.balance).toBe(350);
  });

  it('deposit() includes the note in the description when given', async () => {
    const result = await service.deposit('safe-a', { amount: 100, note: 'كاش في الدرج' }, 'user-1');
    expect(result.transaction.description).toBe('إيداع يدوي: كاش في الدرج');
  });

  it('deposit() throws NotFoundException for an unknown safe', async () => {
    await expect(service.deposit('missing-safe', { amount: 100 }, 'user-1')).rejects.toThrow(NotFoundException);
  });

  it('remove() soft-deletes a safe with a zero balance', async () => {
    safes[0].openingBalance = 0;
    const removed = await service.remove('safe-a');
    expect(removed.active).toBe(false);
  });

  it('remove() refuses to delete a safe with a nonzero balance', async () => {
    await expect(service.remove('safe-a')).rejects.toThrow(ConflictException);
  });

  it('remove() throws NotFoundException for an already-inactive safe', async () => {
    safes[0].active = false;
    await expect(service.remove('safe-a')).rejects.toThrow(NotFoundException);
  });
});
