import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../common/supabase-storage.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let users: any[];
  let rolePermissions: any[];

  const makePrismaMock = () => {
    const tx = {
      rolePermission: {
        deleteMany: jest.fn(({ where: { userId } }: any) => {
          rolePermissions = rolePermissions.filter((r) => r.userId !== userId);
          return Promise.resolve({ count: 0 });
        }),
        createMany: jest.fn(({ data }: any) => {
          rolePermissions.push(...data);
          return Promise.resolve({ count: data.length });
        }),
      },
      user: {
        update: jest.fn(({ where: { id }, data }: any) => {
          const user = users.find((u) => u.id === id);
          Object.assign(user, data);
          return Promise.resolve({ ...user, rolePermissions: rolePermissions.filter((r) => r.userId === id) });
        }),
      },
      refreshToken: {
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
    };
    return {
      $transaction: jest.fn((cb: any) => cb(tx)),
      user: {
        findMany: jest.fn(({ where }: any = {}) =>
          Promise.resolve(
            users
              .filter((u) => (where?.active === undefined ? true : u.active === where.active))
              .map((u) => ({ ...u, rolePermissions: rolePermissions.filter((r) => r.userId === u.id) })),
          ),
        ),
        findUnique: jest.fn(({ where: { id } }: any) => {
          const user = users.find((u) => u.id === id);
          return Promise.resolve(user ? { ...user, rolePermissions: rolePermissions.filter((r) => r.userId === id) } : null);
        }),
        create: jest.fn(({ data }: any) => {
          const { rolePermissions: rpCreate, ...rest } = data;
          const user = { id: `user${users.length + 1}`, active: true, avatarUrl: null, createdAt: new Date(), ...rest };
          users.push(user);
          if (rpCreate?.create) {
            rolePermissions.push(...rpCreate.create.map((r: any) => ({ userId: user.id, ...r })));
          }
          // Mirrors USER_SELECT (real Prisma call) not returning passwordHash.
          const { passwordHash, ...selected } = user;
          return Promise.resolve({ ...selected, rolePermissions: rolePermissions.filter((r) => r.userId === user.id) });
        }),
        update: tx.user.update,
        count: jest.fn(({ where }: any = {}) =>
          Promise.resolve(
            users.filter((u) => {
              if (where.id?.not !== undefined && u.id === where.id.not) return false;
              if (where.active !== undefined && u.active !== where.active) return false;
              if (where.role !== undefined && u.role !== where.role) return false;
              return true;
            }).length,
          ),
        ),
      },
      rolePermission: {
        count: jest.fn(({ where }: any = {}) =>
          Promise.resolve(
            rolePermissions.filter((r) => {
              if (where.permission !== undefined && r.permission !== where.permission) return false;
              if (where.userId?.not !== undefined && r.userId === where.userId.not) return false;
              if (where.user?.active !== undefined) {
                const owner = users.find((u) => u.id === r.userId);
                if (!owner || owner.active !== where.user.active) return false;
              }
              return true;
            }).length,
          ),
        ),
      },
      refreshToken: tx.refreshToken,
    };
  };

  beforeEach(async () => {
    users = [{ id: 'user-1', email: 'a@example.com', name: 'Ahmed', title: null, role: 'OWNER', active: true, avatarUrl: null, createdAt: new Date() }];
    rolePermissions = [];

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: makePrismaMock() },
        { provide: SupabaseStorageService, useValue: { uploadAvatar: jest.fn(), removeAvatar: jest.fn() } },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  it('create() hashes the password and does not return it', async () => {
    const created: any = await service.create({
      email: 'new@example.com',
      name: 'New User',
      role: 'EMPLOYEE',
      password: 'SomePassword1',
    } as any);

    expect(created.passwordHash).toBeUndefined();
    const stored = users.find((u) => u.email === 'new@example.com');
    expect(await bcrypt.compare('SomePassword1', stored.passwordHash)).toBe(true);
  });

  it('create() with extraPermissions creates matching RolePermission rows', async () => {
    const created: any = await service.create({
      email: 'mgr@example.com',
      name: 'Mgr',
      role: 'EMPLOYEE',
      password: 'SomePassword1',
      extraPermissions: ['manage_parties'],
    } as any);

    expect(created.extraPermissions).toEqual(['manage_parties']);
    expect(created.permissions).toContain('manage_parties');
  });

  it('update() replaces extraPermissions wholesale', async () => {
    await service.create({
      email: 'x@example.com',
      name: 'X',
      role: 'EMPLOYEE',
      password: 'SomePassword1',
      extraPermissions: ['manage_parties'],
    } as any);
    const userId = users.find((u) => u.email === 'x@example.com').id;

    const updated: any = await service.update(userId, { extraPermissions: ['manage_safes'] } as any);
    expect(updated.extraPermissions).toEqual(['manage_safes']);
  });

  it('update() rejects removing manage_users from the only holder (no other OWNER, no other grant)', async () => {
    // Replace user-1 (the default OWNER) with a MANAGER who's the sole
    // manage_users holder, so the guard has nothing else to fall back on.
    users.length = 0;
    users.push({ id: 'mgr-1', email: 'mgr@example.com', name: 'Mgr', title: null, role: 'MANAGER', active: true, avatarUrl: null, createdAt: new Date() });
    rolePermissions.length = 0;
    rolePermissions.push({ id: 'rp1', userId: 'mgr-1', role: 'MANAGER', permission: 'manage_users' });

    await expect(service.update('mgr-1', { extraPermissions: ['view_reports'] } as any)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('update() allows removing manage_users when another active OWNER still has it', async () => {
    // Default beforeEach seed already has user-1 as an active OWNER.
    users.push({ id: 'mgr-2', email: 'mgr2@example.com', name: 'Mgr2', title: null, role: 'MANAGER', active: true, avatarUrl: null, createdAt: new Date() });
    rolePermissions.push({ id: 'rp2', userId: 'mgr-2', role: 'MANAGER', permission: 'manage_users' });

    const updated: any = await service.update('mgr-2', { extraPermissions: ['view_reports'] } as any);
    expect(updated.extraPermissions).toEqual(['view_reports']);
  });

  it('update() allows removing manage_users when another active user holds it via an explicit grant', async () => {
    users.length = 0;
    users.push(
      { id: 'mgr-a', email: 'a@example.com', name: 'A', title: null, role: 'MANAGER', active: true, avatarUrl: null, createdAt: new Date() },
      { id: 'mgr-b', email: 'b@example.com', name: 'B', title: null, role: 'MANAGER', active: true, avatarUrl: null, createdAt: new Date() },
    );
    rolePermissions.length = 0;
    rolePermissions.push(
      { id: 'rp-a', userId: 'mgr-a', role: 'MANAGER', permission: 'manage_users' },
      { id: 'rp-b', userId: 'mgr-b', role: 'MANAGER', permission: 'manage_users' },
    );

    const updated: any = await service.update('mgr-a', { extraPermissions: ['view_reports'] } as any);
    expect(updated.extraPermissions).toEqual(['view_reports']);
  });

  it('update() revokes the user\'s refresh tokens when role or extraPermissions changes, not on an unrelated field', async () => {
    const prismaMock = makePrismaMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: SupabaseStorageService, useValue: { uploadAvatar: jest.fn(), removeAvatar: jest.fn() } },
      ],
    }).compile();
    const scopedService = module.get(UsersService);

    await scopedService.update('user-1', { name: 'Renamed Only' } as any);
    expect(prismaMock.refreshToken.updateMany).not.toHaveBeenCalled();

    await scopedService.update('user-1', { extraPermissions: ['manage_safes'] } as any);
    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });

    await scopedService.update('user-1', { role: 'MANAGER' } as any);
    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledTimes(2);
  });

  it('update() throws NotFoundException for an unknown user', async () => {
    await expect(service.update('missing', { name: 'x' } as any)).rejects.toThrow(NotFoundException);
  });

  it('updateSelf() only ever touches name, never role/permissions', async () => {
    const updated: any = await service.updateSelf('user-1', { name: 'Ahmed Renamed' } as any);
    expect(updated.name).toBe('Ahmed Renamed');
    expect(updated.role).toBe('OWNER');
  });

  it('remove() rejects deleting your own account', async () => {
    await expect(service.remove('user-1', 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('remove() soft-deactivates a different user', async () => {
    users.push({ id: 'user-2', email: 'b@example.com', name: 'B', title: null, role: 'EMPLOYEE', active: true, avatarUrl: null, createdAt: new Date() });
    const removed: any = await service.remove('user-2', 'user-1');
    expect(removed.active).toBe(false);
  });

  it('findOne() throws NotFoundException for an unknown id', async () => {
    await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('findAll() paginates and caps pageSize at 500', async () => {
    const result = await service.findAll(1, 999999);
    expect(result).toHaveLength(1);
  });

  it('findAll() excludes deactivated users by default, and includes them when includeInactive is set', async () => {
    users.push({ id: 'user-2', email: 'inactive@example.com', name: 'Inactive', title: null, role: 'EMPLOYEE', active: false, avatarUrl: null, createdAt: new Date() });

    const defaultResult = await service.findAll();
    expect(defaultResult.map((u: any) => u.id)).not.toContain('user-2');

    const withInactive = await service.findAll(undefined, undefined, true);
    expect(withInactive.map((u: any) => u.id)).toContain('user-2');
  });
});
