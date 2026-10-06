import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PartiesService } from '../parties/parties.service';
import { CategoriesService } from '../categories/categories.service';
import { SafesService } from '../safes/safes.service';
import { TransactionsService } from '../transactions/transactions.service';
import { CouriersService } from '../couriers/couriers.service';
import { PendingActionsService } from './pending-actions.service';

/**
 * approve()/reject() must atomically claim a PendingAction (PENDING ->
 * APPROVED/REJECTED) before doing anything else, so two concurrent calls on
 * the same row can't both pass a status check and both execute the
 * underlying action (e.g. double-void a transaction). Modeled with an
 * in-memory fake whose updateMany mimics Postgres's WHERE-guarded update
 * semantics: it only touches (and counts) rows matching the WHERE clause.
 */
describe('PendingActionsService', () => {
  let service: PendingActionsService;
  let actions: any[];
  let transactionsService: { void: jest.Mock };

  const makePrismaMock = () => ({
    pendingAction: {
      findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(actions.find((a) => a.id === id) ?? null)),
      updateMany: jest.fn(({ where, data }: any) => {
        const matches = actions.filter((a) => a.id === where.id && a.status === where.status);
        matches.forEach((a) => Object.assign(a, data));
        return Promise.resolve({ count: matches.length });
      }),
      update: jest.fn(({ where: { id }, data }: any) => {
        const action = actions.find((a) => a.id === id);
        Object.assign(action, data);
        return Promise.resolve(action);
      }),
    },
  });

  beforeEach(async () => {
    actions = [
      {
        id: 'pa-1',
        method: 'POST',
        route: 'transactions/:id/void',
        entityId: 'tx-1',
        payload: {},
        actorId: 'user-1',
        status: 'PENDING',
      },
    ];
    transactionsService = { void: jest.fn(() => Promise.resolve({ reversalId: 'tx-2' })) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PendingActionsService,
        { provide: PrismaService, useValue: makePrismaMock() },
        { provide: PartiesService, useValue: {} },
        { provide: CategoriesService, useValue: {} },
        { provide: SafesService, useValue: {} },
        { provide: TransactionsService, useValue: transactionsService },
        { provide: CouriersService, useValue: {} },
      ],
    }).compile();

    service = module.get(PendingActionsService);
  });

  it('approve() dispatches exactly once even if called twice concurrently on the same action', async () => {
    const [first, second] = await Promise.allSettled([
      service.approve('pa-1', 'reviewer-1'),
      service.approve('pa-1', 'reviewer-1'),
    ]);

    const fulfilled = [first, second].filter((r) => r.status === 'fulfilled');
    const rejected = [first, second].filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);
    expect(transactionsService.void).toHaveBeenCalledTimes(1);
    expect(actions[0].status).toBe('APPROVED');
  });

  it('reverts the claim back to PENDING if dispatch throws, instead of leaving it stuck APPROVED', async () => {
    transactionsService.void.mockRejectedValueOnce(new Error('db hiccup'));

    await expect(service.approve('pa-1', 'reviewer-1')).rejects.toThrow('db hiccup');
    expect(actions[0].status).toBe('PENDING');
  });

  it('rejects approving an already-reviewed action', async () => {
    actions[0].status = 'APPROVED';
    await expect(service.approve('pa-1', 'reviewer-1')).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException for an unknown action', async () => {
    await expect(service.approve('missing', 'reviewer-1')).rejects.toThrow(NotFoundException);
  });

  it('reject() marks the action REJECTED without dispatching anything', async () => {
    await service.reject('pa-1', 'reviewer-1');
    expect(actions[0].status).toBe('REJECTED');
    expect(transactionsService.void).not.toHaveBeenCalled();
  });

  it('reject() also loses a concurrent race the same way approve() does', async () => {
    const [first, second] = await Promise.allSettled([
      service.reject('pa-1', 'reviewer-1'),
      service.reject('pa-1', 'reviewer-1'),
    ]);
    const fulfilled = [first, second].filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
  });
});

/**
 * dispatch()'s switch statement — one case per (method, route) pattern —
 * previously only the "POST transactions/:id/void" path was exercised
 * (via the concurrency tests above). This confirms every other route
 * pattern calls the correct downstream service method with the correct
 * args, and that an unrecognized pattern throws instead of silently
 * doing nothing.
 */
describe('PendingActionsService - dispatch() routing', () => {
  let actions: any[];
  let parties: Record<string, jest.Mock>;
  let categories: Record<string, jest.Mock>;
  let safes: Record<string, jest.Mock>;
  let transactions: Record<string, jest.Mock>;
  let couriers: Record<string, jest.Mock>;
  let service: PendingActionsService;

  function makeAction(method: string, route: string, entityId: string | null, payload: any = {}) {
    return { id: 'pa-1', method, route, entityId, payload, actorId: 'user-1', status: 'PENDING' };
  }

  beforeEach(async () => {
    parties = {
      create: jest.fn(() => Promise.resolve({})),
      update: jest.fn(() => Promise.resolve({})),
      remove: jest.fn(() => Promise.resolve({})),
      createSettlement: jest.fn(() => Promise.resolve({})),
    };
    categories = { create: jest.fn(() => Promise.resolve({})), update: jest.fn(() => Promise.resolve({})), remove: jest.fn(() => Promise.resolve({})) };
    safes = { create: jest.fn(() => Promise.resolve({})), remove: jest.fn(() => Promise.resolve({})), adjustBalance: jest.fn(() => Promise.resolve({})) };
    transactions = {
      create: jest.fn(() => Promise.resolve({})),
      update: jest.fn(() => Promise.resolve({})),
      void: jest.fn(() => Promise.resolve({})),
      createBatch: jest.fn(() => Promise.resolve([])),
    };
    couriers = {
      create: jest.fn(() => Promise.resolve({})),
      update: jest.fn(() => Promise.resolve({})),
      remove: jest.fn(() => Promise.resolve({})),
      createSheetCollection: jest.fn(() => Promise.resolve({})),
      createAdvance: jest.fn(() => Promise.resolve({})),
      createRepayment: jest.fn(() => Promise.resolve({})),
      assignSheetCollection: jest.fn(() => Promise.resolve({})),
    };

    const prismaMock: any = {
      pendingAction: {
        findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(actions.find((a) => a.id === id) ?? null)),
        updateMany: jest.fn(({ where }: any) => {
          const matches = actions.filter((a) => a.id === where.id && a.status === where.status);
          matches.forEach((a) => (a.status = 'APPROVED'));
          return Promise.resolve({ count: matches.length });
        }),
        update: jest.fn(({ data }: any) => {
          Object.assign(actions[0], data);
          return Promise.resolve(actions[0]);
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PendingActionsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: PartiesService, useValue: parties },
        { provide: CategoriesService, useValue: categories },
        { provide: SafesService, useValue: safes },
        { provide: TransactionsService, useValue: transactions },
        { provide: CouriersService, useValue: couriers },
      ],
    }).compile();

    service = module.get(PendingActionsService);
  });

  it('POST parties -> parties.create(payload)', async () => {
    actions = [makeAction('POST', 'parties', null, { name: 'X' })];
    await service.approve('pa-1', 'reviewer-1');
    expect(parties.create).toHaveBeenCalledWith({ name: 'X' });
  });

  it('POST categories -> categories.create(payload)', async () => {
    actions = [makeAction('POST', 'categories', null, { name: 'Y' })];
    await service.approve('pa-1', 'reviewer-1');
    expect(categories.create).toHaveBeenCalledWith({ name: 'Y' });
  });

  it('POST safes -> safes.create(payload)', async () => {
    actions = [makeAction('POST', 'safes', null, { name: 'Safe' })];
    await service.approve('pa-1', 'reviewer-1');
    expect(safes.create).toHaveBeenCalledWith({ name: 'Safe' });
  });

  it('POST transactions -> transactions.create(payload, actorId)', async () => {
    actions = [makeAction('POST', 'transactions', null, { amount: 100 })];
    await service.approve('pa-1', 'reviewer-1');
    expect(transactions.create).toHaveBeenCalledWith({ amount: 100 }, 'user-1');
  });

  it('POST transactions/batch -> transactions.createBatch(payload, actorId)', async () => {
    actions = [makeAction('POST', 'transactions/batch', null, { items: [{ amount: 100 }] })];
    await service.approve('pa-1', 'reviewer-1');
    expect(transactions.createBatch).toHaveBeenCalledWith({ items: [{ amount: 100 }] }, 'user-1');
  });

  it('POST parties/:id/settlements -> parties.createSettlement(entityId, payload, actorId)', async () => {
    actions = [makeAction('POST', 'parties/:id/settlements', 'party-1', { grossAmount: 300000, applicationMode: 'ALL' })];
    await service.approve('pa-1', 'reviewer-1');
    expect(parties.createSettlement).toHaveBeenCalledWith(
      'party-1',
      { grossAmount: 300000, applicationMode: 'ALL' },
      'user-1',
    );
  });

  it('PATCH parties/:id -> parties.update(entityId, payload)', async () => {
    actions = [makeAction('PATCH', 'parties/:id', 'party-1', { name: 'Z' })];
    await service.approve('pa-1', 'reviewer-1');
    expect(parties.update).toHaveBeenCalledWith('party-1', { name: 'Z' });
  });

  it('POST couriers -> couriers.create(payload)', async () => {
    actions = [makeAction('POST', 'couriers', null, { name: 'Ahmed' })];
    await service.approve('pa-1', 'reviewer-1');
    expect(couriers.create).toHaveBeenCalledWith({ name: 'Ahmed' });
  });

  it('PATCH couriers/:id -> couriers.update(entityId, payload)', async () => {
    actions = [makeAction('PATCH', 'couriers/:id', 'courier-1', { phone: '0100' })];
    await service.approve('pa-1', 'reviewer-1');
    expect(couriers.update).toHaveBeenCalledWith('courier-1', { phone: '0100' });
  });

  it('DELETE couriers/:id -> couriers.remove(entityId)', async () => {
    actions = [makeAction('DELETE', 'couriers/:id', 'courier-1', {})];
    await service.approve('pa-1', 'reviewer-1');
    expect(couriers.remove).toHaveBeenCalledWith('courier-1');
  });

  it('POST couriers/sheet-collections -> couriers.createSheetCollection(payload, actorId)', async () => {
    actions = [makeAction('POST', 'couriers/sheet-collections', null, { courierId: null, amount: 10000 })];
    await service.approve('pa-1', 'reviewer-1');
    expect(couriers.createSheetCollection).toHaveBeenCalledWith({ courierId: null, amount: 10000 }, 'user-1');
  });

  it('POST couriers/:id/advances -> couriers.createAdvance(entityId, payload, actorId)', async () => {
    actions = [makeAction('POST', 'couriers/:id/advances', 'courier-1', { amount: 5000 })];
    await service.approve('pa-1', 'reviewer-1');
    expect(couriers.createAdvance).toHaveBeenCalledWith('courier-1', { amount: 5000 }, 'user-1');
  });

  it('POST couriers/:id/advances/:advanceId/repayments -> couriers.createRepayment(entityId, advanceId, payload, actorId)', async () => {
    actions = [
      makeAction('POST', 'couriers/:id/advances/:advanceId/repayments', 'courier-1', {
        advanceId: 'adv-1',
        amount: 2000,
      }),
    ];
    await service.approve('pa-1', 'reviewer-1');
    expect(couriers.createRepayment).toHaveBeenCalledWith(
      'courier-1',
      'adv-1',
      { advanceId: 'adv-1', amount: 2000 },
      'user-1',
    );
  });

  it('PATCH couriers/sheet-collections/:collectionId/assign -> couriers.assignSheetCollection(collectionId, courierId)', async () => {
    actions = [
      makeAction('PATCH', 'couriers/sheet-collections/:collectionId/assign', null, {
        collectionId: 'coll-1',
        courierId: 'courier-1',
      }),
    ];
    await service.approve('pa-1', 'reviewer-1');
    expect(couriers.assignSheetCollection).toHaveBeenCalledWith('coll-1', 'courier-1');
  });

  it('DELETE parties/:id -> parties.remove(entityId)', async () => {
    actions = [makeAction('DELETE', 'parties/:id', 'party-1')];
    await service.approve('pa-1', 'reviewer-1');
    expect(parties.remove).toHaveBeenCalledWith('party-1');
  });

  it('PATCH categories/:id -> categories.update(entityId, payload)', async () => {
    actions = [makeAction('PATCH', 'categories/:id', 'cat-1', { active: false })];
    await service.approve('pa-1', 'reviewer-1');
    expect(categories.update).toHaveBeenCalledWith('cat-1', { active: false });
  });

  it('DELETE categories/:id -> categories.remove(entityId)', async () => {
    actions = [makeAction('DELETE', 'categories/:id', 'cat-1')];
    await service.approve('pa-1', 'reviewer-1');
    expect(categories.remove).toHaveBeenCalledWith('cat-1');
  });

  it('DELETE safes/:id -> safes.remove(entityId)', async () => {
    actions = [makeAction('DELETE', 'safes/:id', 'safe-1')];
    await service.approve('pa-1', 'reviewer-1');
    expect(safes.remove).toHaveBeenCalledWith('safe-1');
  });

  it('POST safes/:id/adjust-balance -> safes.adjustBalance(entityId, payload, actorId)', async () => {
    actions = [makeAction('POST', 'safes/:id/adjust-balance', 'safe-1', { targetBalance: 500 })];
    await service.approve('pa-1', 'reviewer-1');
    expect(safes.adjustBalance).toHaveBeenCalledWith('safe-1', { targetBalance: 500 }, 'user-1');
  });

  it('PATCH transactions/:id -> transactions.update(entityId, payload)', async () => {
    actions = [makeAction('PATCH', 'transactions/:id', 'tx-1', { amount: 50 })];
    await service.approve('pa-1', 'reviewer-1');
    expect(transactions.update).toHaveBeenCalledWith('tx-1', { amount: 50 });
  });

  it('POST transactions/:id/void -> transactions.void(entityId)', async () => {
    actions = [makeAction('POST', 'transactions/:id/void', 'tx-1')];
    await service.approve('pa-1', 'reviewer-1');
    expect(transactions.void).toHaveBeenCalledWith('tx-1');
  });

  it('throws for an unrecognized (method, route) pattern', async () => {
    actions = [makeAction('PUT', 'unknown/:id', 'x-1')];
    await expect(service.approve('pa-1', 'reviewer-1')).rejects.toThrow(BadRequestException);
  });
});
