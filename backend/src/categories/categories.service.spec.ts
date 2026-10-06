import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesService } from './categories.service';

/**
 * Guards protecting the four fixed system categories (وكلاء محافظات,
 * رواسل, مسحوبات, إعادة إدخال) from being deactivated/deleted through the
 * normal Categories UI — see settings.service.ts's resetSystem() and
 * common/system-categories.ts for why these must stay intact.
 */
describe('CategoriesService', () => {
  let service: CategoriesService;
  let categories: any[];

  const makePrismaMock = () => ({
    category: {
      findUnique: jest.fn(({ where: { id, name_kind } }: any) => {
        if (name_kind) {
          return Promise.resolve(
            categories.find((c) => c.name === name_kind.name && c.kind === name_kind.kind) ?? null,
          );
        }
        return Promise.resolve(categories.find((c) => c.id === id) ?? null);
      }),
      findFirst: jest.fn(({ where }: any) => {
        const match = categories.find(
          (c) =>
            c.name === where.name &&
            c.active === true &&
            c.systemKey != null &&
            (!where.id || c.id !== where.id.not),
        );
        return Promise.resolve(match ?? null);
      }),
      create: jest.fn(({ data }: any) => {
        const row = { id: `c${categories.length + 1}`, active: true, systemKey: null, ...data };
        categories.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(({ where: { id }, data }: any) => {
        const row = categories.find((c) => c.id === id);
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
  });

  beforeEach(async () => {
    categories = [
      { id: 'plain-1', name: 'كهرباء', kind: 'OUT', active: true, partyType: null, systemKey: null },
      {
        id: 'sys-1',
        name: 'رواسل',
        kind: 'OUT',
        active: true,
        partyType: 'MERCHANT',
        systemKey: 'MERCHANT_SENDER',
      },
    ];

    const module: TestingModule = await Test.createTestingModule({
      providers: [CategoriesService, { provide: PrismaService, useValue: makePrismaMock() }],
    }).compile();

    service = module.get(CategoriesService);
  });

  it('remove() throws for a systemKey category and leaves it active', async () => {
    await expect(service.remove('sys-1')).rejects.toThrow(BadRequestException);
    expect(categories.find((c) => c.id === 'sys-1')!.active).toBe(true);
  });

  it('remove() soft-deletes a plain category normally', async () => {
    await service.remove('plain-1');
    expect(categories.find((c) => c.id === 'plain-1')!.active).toBe(false);
  });

  it('update() throws when deactivating a systemKey category', async () => {
    await expect(service.update('sys-1', { active: false } as any)).rejects.toThrow(BadRequestException);
    expect(categories.find((c) => c.id === 'sys-1')!.active).toBe(true);
  });

  it('update() allows renaming a systemKey category', async () => {
    const updated = await service.update('sys-1', { name: 'رواسل جديد' } as any);
    expect(updated.name).toBe('رواسل جديد');
    expect(updated.systemKey).toBe('MERCHANT_SENDER');
  });

  // Guards against the exact confusion a user hit in practice: manually
  // toggling "يتطلب جهة"/"مندوب" on a fixed system category has no real
  // effect (its dedicated flow finds it by systemKey, not by this field)
  // and only misleads — so changing either is rejected outright, same tier
  // as the existing active:false guard.
  it('update() throws when changing partyType on a systemKey category', async () => {
    await expect(service.update('sys-1', { partyType: null } as any)).rejects.toThrow(BadRequestException);
    expect(categories.find((c) => c.id === 'sys-1')!.partyType).toBe('MERCHANT');
  });

  it('update() throws when setting requiresCourier on a systemKey category', async () => {
    await expect(service.update('sys-1', { requiresCourier: true } as any)).rejects.toThrow(BadRequestException);
    expect(categories.find((c) => c.id === 'sys-1')!.requiresCourier).toBeUndefined();
  });

  it('update() allows re-submitting the SAME partyType on a systemKey category (no-op, not a change)', async () => {
    const updated = await service.update('sys-1', { name: 'رواسل', partyType: 'MERCHANT' } as any);
    expect(updated.partyType).toBe('MERCHANT');
  });

  it('update() still allows changing partyType/requiresCourier on a plain (non-system) category', async () => {
    const updated = await service.update('plain-1', { requiresCourier: true } as any);
    expect(updated.requiresCourier).toBe(true);
  });

  it('create() persists partyType instead of silently dropping it', async () => {
    const created = await service.create({ name: 'بند جديد', kind: 'IN', partyType: 'AGENT' } as any);
    expect(created.partyType).toBe('AGENT');
  });

  it('create() rejects a duplicate name+kind', async () => {
    await expect(service.create({ name: 'كهرباء', kind: 'OUT' } as any)).rejects.toThrow(ConflictException);
  });

  // Phase 36: a plain category silently sharing a name with a system
  // category is exactly how تحصيل شيتات transactions ended up invisible on
  // the courier's own page — both the frontend's courier-field detection
  // and the backend's courier-ledger guard key strictly on systemKey, so a
  // same-named plain category looks identical in the UI but never reaches
  // the real linked flow.
  it('create() rejects a plain category whose name matches an active system category', async () => {
    await expect(service.create({ name: 'رواسل', kind: 'IN' } as any)).rejects.toThrow(BadRequestException);
  });

  it('create() allows a name that matches an INACTIVE system category', async () => {
    categories.find((c) => c.id === 'sys-1')!.active = false;
    const created = await service.create({ name: 'رواسل', kind: 'IN' } as any);
    expect(created.name).toBe('رواسل');
  });

  it('update() rejects renaming a plain category to collide with a system category name', async () => {
    await expect(service.update('plain-1', { name: 'رواسل' } as any)).rejects.toThrow(BadRequestException);
    expect(categories.find((c) => c.id === 'plain-1')!.name).toBe('كهرباء');
  });

  it('update() allows a system category to rename itself without tripping the name-collision guard', async () => {
    const updated = await service.update('sys-1', { name: 'رواسل محدث' } as any);
    expect(updated.name).toBe('رواسل محدث');
  });
});
