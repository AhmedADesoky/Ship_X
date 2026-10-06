import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SafesService } from '../safes/safes.service';
import { CouriersService } from './couriers.service';

const makeSafesServiceMock = (overrides: { rejectSafeId?: string } = {}) => ({
  assertSufficientBalance: jest.fn((safeId: string) => {
    if (safeId === overrides.rejectSafeId) {
      return Promise.reject(new BadRequestException('رصيد الخزنة غير كافٍ'));
    }
    return Promise.resolve();
  }),
});

const CATEGORIES: Record<string, { id: string; systemKey: string }> = {
  COURIER_SHEET_COLLECTION: { id: 'cat-sheet', systemKey: 'COURIER_SHEET_COLLECTION' },
  COURIER_ADVANCE: { id: 'cat-advance', systemKey: 'COURIER_ADVANCE' },
  COURIER_ADVANCE_REPAYMENT: { id: 'cat-repay', systemKey: 'COURIER_ADVANCE_REPAYMENT' },
};

/**
 * No live Postgres instance is available in this environment, so
 * PrismaService is fully mocked with in-memory arrays, same established
 * pattern as parties.service.spec.ts. Focused on: real Transaction
 * creation for each of the 3 event types, the advance repayment
 * lifecycle/status machine, and — the single most important case for this
 * module — an explicit proof that sheet collections and advances are
 * never netted against each other.
 */
describe('CouriersService', () => {
  let service: CouriersService;
  let couriers: { id: string; name: string; active: boolean }[];
  let transactions: any[];
  let sheetCollections: any[];
  let advances: any[];
  let repayments: any[];
  let idCounter: number;

  const makePrisma = (safesOverrides: { rejectSafeId?: string } = {}) => {
    const tx: any = {
      safe: { findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve({ id, name: id })) },
      transaction: {
        create: jest.fn(({ data }: any) => {
          const row = { id: `t${idCounter++}`, status: 'POSTED', ...data };
          transactions.push(row);
          return Promise.resolve(row);
        }),
      },
      courierSheetCollection: {
        create: jest.fn(({ data }: any) => {
          const row = { id: `s${idCounter++}`, ...data };
          sheetCollections.push(row);
          return Promise.resolve(row);
        }),
      },
      courierAdvance: {
        create: jest.fn(({ data }: any) => {
          const row = { id: `a${idCounter++}`, ...data };
          advances.push(row);
          return Promise.resolve(row);
        }),
        findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(advances.find((a) => a.id === id) ?? null)),
        update: jest.fn(({ where: { id }, data }: any) => {
          const row = advances.find((a) => a.id === id);
          Object.assign(row, data);
          return Promise.resolve({ ...row });
        }),
      },
      courierAdvanceRepayment: {
        create: jest.fn(({ data }: any) => {
          const row = { id: `r${idCounter++}`, ...data };
          repayments.push(row);
          return Promise.resolve(row);
        }),
      },
    };

    return {
      $transaction: jest.fn((cb: any) => cb(tx)),
      courier: {
        findUnique: jest.fn(({ where }: any) =>
          Promise.resolve(couriers.find((c) => c.id === where.id || c.name === where.name) ?? null),
        ),
        create: jest.fn(({ data }: any) => {
          const row = { id: `c${idCounter++}`, active: true, ...data };
          couriers.push(row);
          return Promise.resolve(row);
        }),
        update: jest.fn(({ where: { id }, data }: any) => {
          const row = couriers.find((c) => c.id === id);
          Object.assign(row!, data);
          return Promise.resolve({ ...row });
        }),
      },
      category: {
        findUnique: jest.fn(({ where: { systemKey } }: any) => Promise.resolve(CATEGORIES[systemKey] ?? null)),
      },
      courierSheetCollection: {
        aggregate: jest.fn(({ where }: any) => {
          const rows = sheetCollections.filter((s) => s.courierId === where.courierId);
          return Promise.resolve({
            _sum: { amount: rows.reduce((sum, r) => sum + Number(r.amount), 0) || null },
            _count: rows.length,
          });
        }),
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(sheetCollections.filter((s) => s.courierId === where.courierId)),
        ),
        findUnique: jest.fn(({ where: { id } }: any) =>
          Promise.resolve(sheetCollections.find((s) => s.id === id) ?? null),
        ),
        update: jest.fn(({ where: { id }, data }: any) => {
          const row = sheetCollections.find((s) => s.id === id);
          Object.assign(row!, data);
          return Promise.resolve({ ...row });
        }),
      },
      courierAdvance: {
        aggregate: jest.fn(({ where }: any) => {
          let rows = advances.filter((a) => a.courierId === where.courierId);
          if (where.remainingAmount) rows = rows.filter((a) => Number(a.remainingAmount) > 0);
          const sumField = where.remainingAmount ? 'remainingAmount' : 'originalAmount';
          return Promise.resolve({
            _sum: { [sumField]: rows.reduce((sum, r) => sum + Number(r[sumField]), 0) || null },
          });
        }),
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(advances.filter((a) => a.courierId === where.courierId).map((a) => ({ ...a, safe: { id: a.safeId, name: a.safeId } }))),
        ),
      },
      courierAdvanceRepayment: {
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(
            repayments
              .filter((r) => advances.find((a) => a.id === r.advanceId)?.courierId === where.advance.courierId)
              .map((r) => ({
                ...r,
                safe: { id: r.safeId, name: r.safeId },
                advance: advances.find((a) => a.id === r.advanceId),
              })),
          ),
        ),
      },
    };
  };

  const setup = async (safesOverrides: { rejectSafeId?: string } = {}) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CouriersService,
        { provide: PrismaService, useValue: makePrisma(safesOverrides) },
        { provide: SafesService, useValue: makeSafesServiceMock(safesOverrides) },
      ],
    }).compile();
    return module.get(CouriersService);
  };

  beforeEach(async () => {
    idCounter = 1;
    couriers = [{ id: 'courier-1', name: 'Ahmed Nasr', active: true }];
    transactions = [];
    sheetCollections = [];
    advances = [];
    repayments = [];
    service = await setup();
  });

  describe('update() and remove()', () => {
    it('update() changes the courier fields', async () => {
      const updated = await service.update('courier-1', { phone: '0100000000' });
      expect(updated.phone).toBe('0100000000');
    });

    it('remove() soft-deletes — sets active false, does not hard-delete', async () => {
      const removed = await service.remove('courier-1');
      expect(removed.active).toBe(false);
      expect(couriers.find((c) => c.id === 'courier-1')).toBeDefined();
    });

    it('remove() throws for an unknown courier', async () => {
      await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createSheetCollection()', () => {
    it('with a real courier creates a real IN transaction for the exact amount', async () => {
      const result = await service.createSheetCollection(
        { courierId: 'courier-1', safeId: 'safe-a', amount: 10_000 },
        'user-1',
      );

      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toMatchObject({ kind: 'IN', amount: 10_000, safeId: 'safe-a' });
      expect(result.transactionId).toBe(transactions[0].id);
      expect(result.courierId).toBe('courier-1');
    });

    it('with courierId null succeeds — historical/opening collection, not forced onto a courier', async () => {
      const result = await service.createSheetCollection({ courierId: null, safeId: 'safe-a', amount: 300_000 }, 'user-1');

      expect(transactions).toHaveLength(1);
      expect(result.courierId).toBeNull();
    });

    it('rejects an unknown courier id', async () => {
      await expect(
        service.createSheetCollection({ courierId: 'nope', safeId: 'safe-a', amount: 100 }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
      expect(transactions).toHaveLength(0);
    });
  });

  describe('createAdvance()', () => {
    it('creates a real OUT transaction, remaining starts equal to original, status OPEN', async () => {
      const result = await service.createAdvance('courier-1', { safeId: 'safe-a', amount: 5_000 }, 'user-1');

      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toMatchObject({ kind: 'OUT', amount: 5_000 });
      expect(Number(result.remainingAmount)).toBe(5_000);
      expect(result.status).toBe('OPEN');
    });

    it('rejects when the safe cannot cover it, and writes nothing', async () => {
      service = await setup({ rejectSafeId: 'safe-a' });
      await expect(service.createAdvance('courier-1', { safeId: 'safe-a', amount: 5_000 }, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(transactions).toHaveLength(0);
      expect(advances).toHaveLength(0);
    });

    it('allows multiple concurrent open advances for the same courier (confirmed decision — no blocking guard)', async () => {
      await service.createAdvance('courier-1', { safeId: 'safe-a', amount: 5_000 }, 'user-1');
      await expect(
        service.createAdvance('courier-1', { safeId: 'safe-a', amount: 3_000 }, 'user-1'),
      ).resolves.toBeDefined();
      expect(advances.filter((a) => a.courierId === 'courier-1')).toHaveLength(2);
    });
  });

  describe('createRepayment()', () => {
    it('partial repayment creates a real IN transaction, decrements remaining, status PARTIALLY_REPAID', async () => {
      const advance = await service.createAdvance('courier-1', { safeId: 'safe-a', amount: 5_000 }, 'user-1');

      const { advance: updated } = await service.createRepayment(
        'courier-1',
        advance.id,
        { advanceId: advance.id, safeId: 'safe-a', amount: 2_000 },
        'user-1',
      );

      expect(Number(updated.remainingAmount)).toBe(3_000);
      expect(updated.status).toBe('PARTIALLY_REPAID');
      expect(transactions.filter((t) => t.kind === 'IN')).toHaveLength(1);
    });

    it('repaying the full remaining amount sets status FULLY_REPAID, remaining 0', async () => {
      const advance = await service.createAdvance('courier-1', { safeId: 'safe-a', amount: 5_000 }, 'user-1');

      const { advance: updated } = await service.createRepayment(
        'courier-1',
        advance.id,
        { advanceId: advance.id, safeId: 'safe-a', amount: 5_000 },
        'user-1',
      );

      expect(Number(updated.remainingAmount)).toBe(0);
      expect(updated.status).toBe('FULLY_REPAID');
    });

    it('rejects a repayment exceeding the remaining amount, writes nothing', async () => {
      const advance = await service.createAdvance('courier-1', { safeId: 'safe-a', amount: 5_000 }, 'user-1');
      const txCountBefore = transactions.length;

      await expect(
        service.createRepayment('courier-1', advance.id, { advanceId: advance.id, safeId: 'safe-a', amount: 6_000 }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(transactions).toHaveLength(txCountBefore);
    });

    it('rejects a non-positive repayment amount', async () => {
      const advance = await service.createAdvance('courier-1', { safeId: 'safe-a', amount: 5_000 }, 'user-1');
      await expect(
        service.createRepayment('courier-1', advance.id, { advanceId: advance.id, safeId: 'safe-a', amount: 0 }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an advance that does not belong to this courier', async () => {
      couriers.push({ id: 'courier-2', name: 'Other', active: true });
      const advance = await service.createAdvance('courier-1', { safeId: 'safe-a', amount: 5_000 }, 'user-1');
      await expect(
        service.createRepayment('courier-2', advance.id, { advanceId: advance.id, safeId: 'safe-a', amount: 1_000 }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  /**
   * THE explicit anti-netting proof — the single hardest business rule in
   * this module. An advance and a sheet collection for the same courier
   * must remain completely independent: the sheet amount is never reduced
   * by the outstanding advance, and the advance's remaining balance is
   * never touched by a sheet collection.
   */
  describe('anti-netting: sheet collections and advances never affect each other', () => {
    it('a 5,000 advance followed by a 10,000 sheet collection leaves both figures exactly as posted', async () => {
      const advance = await service.createAdvance('courier-1', { safeId: 'safe-a', amount: 5_000 }, 'user-1');
      const sheet = await service.createSheetCollection(
        { courierId: 'courier-1', safeId: 'safe-a', amount: 10_000 },
        'user-1',
      );

      // The sheet collection's amount must be the full 10,000 — never
      // reduced because of the outstanding 5,000 advance.
      expect(Number(sheet.amount)).toBe(10_000);

      // The advance's remaining balance must still be exactly 5,000 —
      // completely untouched by the sheet collection.
      const refreshedAdvance = advances.find((a) => a.id === advance.id);
      expect(Number(refreshedAdvance.remainingAmount)).toBe(5_000);

      // Two fully independent Transaction rows — no relatedTransactionId
      // or any other link between them.
      expect(transactions).toHaveLength(2);
      const advanceTx = transactions.find((t) => t.kind === 'OUT');
      const sheetTx = transactions.find((t) => t.kind === 'IN');
      expect(advanceTx.amount).toBe(5_000);
      expect(sheetTx.amount).toBe(10_000);
      expect(advanceTx.relatedTransactionId).toBeUndefined();
      expect(sheetTx.relatedTransactionId).toBeUndefined();
    });

    it('summary() computes sheetCollectionsTotal and outstandingAdvances independently — a repayment never changes the sheet total', async () => {
      const advance = await service.createAdvance('courier-1', { safeId: 'safe-a', amount: 5_000 }, 'user-1');
      await service.createSheetCollection({ courierId: 'courier-1', safeId: 'safe-a', amount: 10_000 }, 'user-1');

      const before = await service.summary('courier-1');
      expect(before.sheetCollectionsTotal).toBe(10_000);
      expect(before.outstandingAdvances).toBe(5_000);

      await service.createRepayment(
        'courier-1',
        advance.id,
        { advanceId: advance.id, safeId: 'safe-a', amount: 2_000 },
        'user-1',
      );

      const after = await service.summary('courier-1');
      // The repayment changed outstandingAdvances, but sheetCollectionsTotal
      // must be byte-for-byte unchanged.
      expect(after.sheetCollectionsTotal).toBe(10_000);
      expect(after.outstandingAdvances).toBe(3_000);
      expect(after.advancesTotal).toBe(5_000); // total ever advanced, independent of repayments
    });
  });

  describe('listUnassignedSheetCollections() / assignSheetCollection() — Phase 35', () => {
    it('listUnassignedSheetCollections() returns only courierId:null rows', async () => {
      await service.createSheetCollection({ courierId: 'courier-1', safeId: 'safe-a', amount: 1000 }, 'user-1');
      await service.createSheetCollection({ courierId: null, safeId: 'safe-a', amount: 2000 }, 'user-1');

      const unassigned = await service.listUnassignedSheetCollections();
      expect(unassigned).toHaveLength(1);
      expect(Number(unassigned[0].amount)).toBe(2000);
      expect(unassigned[0].courierId).toBeNull();
    });

    it('assignSheetCollection() attaches an existing unassigned row to a real courier', async () => {
      const created = await service.createSheetCollection({ courierId: null, safeId: 'safe-a', amount: 2000 }, 'user-1');

      const assigned = await service.assignSheetCollection(created.id, 'courier-1');
      expect(assigned.courierId).toBe('courier-1');

      const unassigned = await service.listUnassignedSheetCollections();
      expect(unassigned).toHaveLength(0);
    });

    it('assignSheetCollection() rejects an unknown courier, leaving the row unassigned', async () => {
      const created = await service.createSheetCollection({ courierId: null, safeId: 'safe-a', amount: 2000 }, 'user-1');
      await expect(service.assignSheetCollection(created.id, 'nope')).rejects.toThrow(NotFoundException);

      const row = sheetCollections.find((s) => s.id === created.id)!;
      expect(row.courierId).toBeNull();
    });

    it('assignSheetCollection() rejects an unknown collection id', async () => {
      await expect(service.assignSheetCollection('nope', 'courier-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('statement() — remaining/settled per event', () => {
    it('ADVANCE and ADVANCE_REPAYMENT events each carry the current remaining/settled state of their advance', async () => {
      const advance = await service.createAdvance('courier-1', { safeId: 'safe-a', amount: 1000 }, 'user-1');
      await service.createRepayment('courier-1', advance.id, { advanceId: advance.id, safeId: 'safe-a', amount: 400 }, 'user-1');

      const events = await service.statement('courier-1');
      const advanceEvent = events.find((e) => e.type === 'ADVANCE')!;
      const repaymentEvent = events.find((e) => e.type === 'ADVANCE_REPAYMENT')! as any;

      expect(advanceEvent).toMatchObject({ remaining: 600, settled: false });
      expect(repaymentEvent).toMatchObject({ remaining: 600, settled: false });

      await service.createRepayment('courier-1', advance.id, { advanceId: advance.id, safeId: 'safe-a', amount: 600 }, 'user-1');
      const eventsAfterFull = await service.statement('courier-1');
      expect(eventsAfterFull.find((e) => e.type === 'ADVANCE')).toMatchObject({ remaining: 0, settled: true });
    });
  });
});
