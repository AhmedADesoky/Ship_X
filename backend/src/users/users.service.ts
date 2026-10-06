import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSelfDto } from './dto/update-self.dto';
import { effectivePermissions, Role } from '../common/role-permissions';
import { SupabaseStorageService } from '../common/supabase-storage.service';

const BCRYPT_ROUNDS = 12;

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  title: true,
  role: true,
  active: true,
  avatarUrl: true,
  createdAt: true,
  rolePermissions: { select: { permission: true } },
} as const;

type RawUser = {
  id: string;
  email: string;
  name: string;
  title: string | null;
  role: Role;
  active: boolean;
  avatarUrl: string | null;
  createdAt: Date;
  rolePermissions: { permission: string }[];
};

// Flattens the raw rolePermissions relation into the extra-grants list plus
// the role+extra effective permission set, so the frontend doesn't need to
// know how permissions are stored to render the checklist / gate the UI.
function present(user: RawUser) {
  const { rolePermissions, ...rest } = user;
  const extraPermissions = rolePermissions.map((r) => r.permission);
  return {
    ...rest,
    extraPermissions,
    permissions: effectivePermissions(user.role, extraPermissions),
  };
}

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private storage: SupabaseStorageService,
  ) {}

  // Deactivated accounts (remove()/DELETE is a soft-deactivate — see its
  // docstring) are excluded from the default list so a "deleted" user
  // actually disappears from the Users page, instead of staying listed
  // forever with no visible difference from an active one. Pass
  // includeInactive to see/reactivate them (the toggle UI needs this).
  async findAll(page?: number, pageSize?: number, includeInactive?: boolean) {
    const size = Math.min(pageSize || 50, 500);
    const p = Math.max(page || 1, 1);
    const users = await this.prisma.user.findMany({
      where: includeInactive ? undefined : { active: true },
      select: USER_SELECT,
      orderBy: { createdAt: 'desc' },
      take: size,
      skip: (p - 1) * size,
    });
    return users.map(present);
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!user) throw new NotFoundException('User not found');
    return present(user);
  }

  async create(dto: CreateUserDto) {
    // TODO(supabase-auth): once Supabase Auth is wired up, account creation
    // moves to its admin API and this local bcrypt hash goes away — it's an
    // interim step so login actually verifies a real password today.
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        title: dto.title,
        role: dto.role,
        active: dto.active ?? true,
        passwordHash,
        rolePermissions: dto.extraPermissions?.length
          ? { create: dto.extraPermissions.map((permission) => ({ role: dto.role, permission })) }
          : undefined,
      },
      select: USER_SELECT,
    });
    return present(user);
  }

  async update(id: string, dto: UpdateUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('User not found');

    const { password, extraPermissions, ...rest } = dto;
    const passwordHash = password ? await bcrypt.hash(password, BCRYPT_ROUNDS) : undefined;

    // Now that MANAGER/ACCOUNTANT/EMPLOYEE permissions are fully free-form
    // (role-permissions.ts's effectivePermissions() no longer unions a
    // role-default floor back in for them), it's possible to edit the
    // system into a state with zero manage_users holders — nobody left who
    // could ever re-grant it. OWNER is exempt from this check since its
    // own manage_users is hardcoded-always-present, never row-driven.
    if (extraPermissions !== undefined && !extraPermissions.includes('manage_users')) {
      const targetRole = rest.role ?? existing.role;
      if (targetRole !== 'OWNER') {
        const otherOwner = await this.prisma.user.count({
          where: { id: { not: id }, active: true, role: 'OWNER' },
        });
        if (otherOwner === 0) {
          const otherGrant = await this.prisma.rolePermission.count({
            where: { permission: 'manage_users', userId: { not: id }, user: { active: true } },
          });
          if (otherGrant === 0) {
            throw new BadRequestException('يجب أن يحتفظ مستخدم واحد على الأقل بصلاحية إدارة المستخدمين');
          }
        }
      }
    }

    const user = await this.prisma.$transaction(async (tx) => {
      if (extraPermissions !== undefined) {
        // Replace this user's extra grants wholesale — simplest correct
        // semantics for a checklist-style editor (checked = granted).
        await tx.rolePermission.deleteMany({ where: { userId: id } });
        if (extraPermissions.length > 0) {
          await tx.rolePermission.createMany({
            data: extraPermissions.map((permission) => ({
              userId: id,
              role: rest.role ?? existing.role,
              permission,
            })),
          });
        }
      }
      const updated = await tx.user.update({
        where: { id },
        data: { ...rest, ...(passwordHash ? { passwordHash } : {}) },
        select: USER_SELECT,
      });

      // A role or permission change shouldn't silently keep working on the
      // user's existing session for up to the access token's full 15-minute
      // lifetime — revoke their refresh tokens so the next /auth/refresh
      // attempt fails and forces a fresh login, which re-signs the access
      // token with the new effective permissions right away. Same
      // revoke-all pattern already used for reuse-detection in
      // auth.service.ts.
      if (extraPermissions !== undefined || rest.role !== undefined) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      return updated;
    });

    return present(user);
  }

  async updateSelf(id: string, dto: UpdateSelfDto) {
    const user = await this.prisma.user.update({
      where: { id },
      data: { ...(dto.name !== undefined ? { name: dto.name } : {}) },
      select: USER_SELECT,
    });
    return present(user);
  }

  async uploadAvatar(id: string, file: Express.Multer.File) {
    const avatarUrl = await this.storage.uploadAvatar(id, file);
    const user = await this.prisma.user.update({ where: { id }, data: { avatarUrl }, select: USER_SELECT });
    return present(user);
  }

  async removeAvatar(id: string) {
    await this.storage.removeAvatar(id);
    const user = await this.prisma.user.update({ where: { id }, data: { avatarUrl: null }, select: USER_SELECT });
    return present(user);
  }

  async remove(id: string, callerId: string) {
    if (id === callerId) {
      throw new BadRequestException('لا يمكنك حذف حسابك الخاص');
    }
    await this.findOne(id);
    // Soft-delete: deactivate rather than hard-delete, preserving FK history
    // (transactions.created_by, audit_logs.actor_id) and audit trail.
    const user = await this.prisma.user.update({
      where: { id },
      data: { active: false },
      select: USER_SELECT,
    });
    return present(user);
  }
}
