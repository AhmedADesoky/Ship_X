import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from './settings.service';

/**
 * resetSystem() (full wipe, including entities) vs clearNumbers() (ledger
 * only, entities untouched) — the two destructive settings actions. No
 * live Postgres in this environment, so PrismaService is fully mocked
 * with in-memory arrays, same pattern used throughout this repo.
 */
describe('SettingsService', () => {
  let service: SettingsService;
  let state: {
    partyDeferredPayment: any[];
    partyDeferred: any[];
    partyDrawing: any[];
    withdrawalApplication: any[];
    partySettlement: any[];
    courierAdvanceRepayment: any[];
    courierAdvance: any[];
    courierSheetCollection: any[];
    pendingAction: any[];
    auditLog: any[];
    transaction: any[];
    reconciliation: any[];
    importBatch: any[];
    party: any[];
    courier: any[];
    category: any[];
    safe: any[];
  };

  let deleteOrder: string[];

  const makeCollection = (key: keyof typeof state) => ({
    deleteMany: jest.fn(() => {
      deleteOrder.push(key);
      const count = state[key].length;
      state[key] = [];
      return Promise.resolve({ count });
    }),
    updateMany: jest.fn(({ data }: any) => {
      state[key].forEach((row: any) => Object.assign(row, data));
      return Promise.resolve({ count: state[key].length });
    }),
    createMany: jest.fn(({ data }: any) => {
      state[key].push(...(Array.isArray(data) ? data : [data]));
      return Promise.resolve({ count: Array.isArray(data) ? data.length : 1 });
    }),
  });

  const makePrismaMock = () => {
    const prismaMock: any = {};
    (Object.keys(state) as (keyof typeof state)[]).forEach((key) => {
      prismaMock[key] = makeCollection(key);
    });
    prismaMock.$transaction = jest.fn((ops: Promise<any>[]) => Promise.all(ops));
    return prismaMock;
  };

  beforeEach(async () => {
    deleteOrder = [];
    state = {
      partyDeferredPayment: [{ id: 'pdp1' }],
      partyDeferred: [{ id: 'pd1' }],
      partyDrawing: [{ id: 'draw1' }],
      withdrawalApplication: [{ id: 'wa1' }],
      partySettlement: [{ id: 'ps1' }],
      courierAdvanceRepayment: [{ id: 'car1' }],
      courierAdvance: [{ id: 'ca1' }],
      courierSheetCollection: [{ id: 'csc1' }],
      pendingAction: [{ id: 'pa1' }],
      auditLog: [{ id: 'al1' }],
      transaction: [{ id: 'tx1' }],
      reconciliation: [{ id: 'r1' }],
      importBatch: [{ id: 'ib1' }],
      party: [{ id: 'party1' }],
      courier: [{ id: 'courier1' }],
      category: [{ id: 'cat1' }],
      safe: [{ id: 'safe1', openingBalance: 500 }],
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [SettingsService, { provide: PrismaService, useValue: makePrismaMock() }],
    }).compile();

    service = module.get(SettingsService);
  });

  describe('clearNumbers()', () => {
    it('rejects a wrong confirmation phrase without touching any table', async () => {
      await expect(service.clearNumbers('WRONG')).rejects.toThrow(BadRequestException);
      expect(state.transaction).toHaveLength(1);
      expect(state.safe[0].openingBalance).toBe(500);
    });

    it('empties every ledger table and zeroes safe openingBalance, leaving parties/categories untouched', async () => {
      const result = await service.clearNumbers('CLEAR');

      expect(result).toEqual({ cleared: true });
      expect(state.partyDeferredPayment).toHaveLength(0);
      expect(state.partyDeferred).toHaveLength(0);
      expect(state.partyDrawing).toHaveLength(0);
      expect(state.withdrawalApplication).toHaveLength(0);
      expect(state.partySettlement).toHaveLength(0);
      expect(state.courierAdvanceRepayment).toHaveLength(0);
      expect(state.courierAdvance).toHaveLength(0);
      expect(state.courierSheetCollection).toHaveLength(0);
      expect(state.pendingAction).toHaveLength(0);
      expect(state.auditLog).toHaveLength(0);
      expect(state.transaction).toHaveLength(0);
      expect(state.reconciliation).toHaveLength(0);
      expect(state.importBatch).toHaveLength(0);
      expect(state.safe[0].openingBalance).toBe(0);

      // The entities themselves are the whole point of this action — they
      // must survive, unlike resetSystem() below.
      expect(state.party).toHaveLength(1);
      expect(state.courier).toHaveLength(1);
      expect(state.category).toHaveLength(1);
      expect(state.safe).toHaveLength(1);
    });

    // Regression test: withdrawal_applications.drawing_id/settlement_id
    // are FKs into party_drawings/party_settlements — deleting those
    // parents first throws a live FK-violation error that this repo's
    // simple in-memory $transaction mock can't itself catch, so this
    // asserts the actual delete ORDER instead.
    it('deletes withdrawalApplication and partySettlement before partyDrawing (FK order)', async () => {
      await service.clearNumbers('CLEAR');
      expect(deleteOrder.indexOf('withdrawalApplication')).toBeLessThan(deleteOrder.indexOf('partyDrawing'));
      expect(deleteOrder.indexOf('partySettlement')).toBeLessThan(deleteOrder.indexOf('partyDrawing'));
    });
  });

  describe('resetSystem()', () => {
    it('rejects a wrong confirmation phrase without touching any table', async () => {
      await expect(service.resetSystem('WRONG')).rejects.toThrow(BadRequestException);
      expect(state.party).toHaveLength(1);
    });

    it('wipes parties, categories, and safes too — the full-reset contrast case', async () => {
      await service.resetSystem('RESET');

      expect(state.party).toHaveLength(0);
      expect(state.courier).toHaveLength(0);
      expect(state.withdrawalApplication).toHaveLength(0);
      expect(state.partySettlement).toHaveLength(0);
      expect(state.courierAdvanceRepayment).toHaveLength(0);
      expect(state.courierAdvance).toHaveLength(0);
      expect(state.courierSheetCollection).toHaveLength(0);
      expect(state.safe).toHaveLength(0);
      // category is deleteMany'd then re-seeded with the fixed system
      // categories (see common/system-categories.ts) — not left empty.
      expect(state.category.length).toBeGreaterThan(0);
      expect(state.category.every((c: any) => c.systemKey)).toBe(true);
    });

    it('deletes withdrawalApplication and partySettlement before partyDrawing (FK order)', async () => {
      await service.resetSystem('RESET');
      expect(deleteOrder.indexOf('withdrawalApplication')).toBeLessThan(deleteOrder.indexOf('partyDrawing'));
      expect(deleteOrder.indexOf('partySettlement')).toBeLessThan(deleteOrder.indexOf('partyDrawing'));
    });
  });
});
