import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let users: any[];
  let refreshTokens: any[];

  const makePrismaMock = () => ({
    user: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(users.find((u) => (where.id ? u.id === where.id : u.email === where.email)) ?? null),
      ),
      update: jest.fn(({ where: { id }, data }: any) => {
        const user = users.find((u) => u.id === id);
        Object.assign(user, data);
        return Promise.resolve(user);
      }),
    },
    rolePermission: {
      findMany: jest.fn(() => Promise.resolve([])),
    },
    refreshToken: {
      create: jest.fn(({ data }: any) => {
        const row = { id: `rt${refreshTokens.length + 1}`, revokedAt: null, replacedByTokenId: null, ...data };
        refreshTokens.push(row);
        return Promise.resolve(row);
      }),
      findUnique: jest.fn(({ where: { tokenHash, id } }: any) =>
        Promise.resolve(refreshTokens.find((r) => (tokenHash ? r.tokenHash === tokenHash : r.id === id)) ?? null),
      ),
      update: jest.fn(({ where: { id }, data }: any) => {
        const row = refreshTokens.find((r) => r.id === id);
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
      updateMany: jest.fn(({ where, data }: any) => {
        const matches = refreshTokens.filter(
          (r) =>
            (!where.userId || r.userId === where.userId) &&
            (!where.tokenHash || r.tokenHash === where.tokenHash) &&
            (where.revokedAt === undefined || r.revokedAt === where.revokedAt),
        );
        matches.forEach((r) => Object.assign(r, data));
        return Promise.resolve({ count: matches.length });
      }),
    },
  });

  beforeEach(async () => {
    refreshTokens = [];
    const passwordHash = await bcrypt.hash('CorrectHorse123', 10);
    users = [
      {
        id: 'user-1',
        email: 'owner@example.com',
        passwordHash,
        active: true,
        failedLoginCount: 0,
        lockedUntil: null,
        role: 'OWNER',
        title: null,
        avatarUrl: null,
        mfaEnabled: false,
        mfaSecret: null,
        mfaTempSecret: null,
        resetTokenHash: null,
        resetTokenExpiresAt: null,
      },
    ];

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: makePrismaMock() },
        { provide: JwtService, useValue: new JwtService() },
        {
          provide: require('@nestjs/config').ConfigService,
          useValue: { get: (key: string) => (key === 'NODE_ENV' ? 'test' : undefined) },
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('login()', () => {
    it('rejects a wrong password', async () => {
      await expect(service.login({ email: 'owner@example.com', password: 'wrong' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an unknown email', async () => {
      await expect(service.login({ email: 'nobody@example.com', password: 'CorrectHorse123' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('issues tokens for correct credentials when MFA is not enabled', async () => {
      const result: any = await service.login({ email: 'owner@example.com', password: 'CorrectHorse123' });
      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.refreshToken).toEqual(expect.any(String));
      expect(result.user.email).toBe('owner@example.com');
    });

    it('reports mfaRequired without issuing tokens when MFA is enabled and no code is given', async () => {
      users[0].mfaEnabled = true;
      users[0].mfaSecret = authenticator.generateSecret();

      const result = await service.login({ email: 'owner@example.com', password: 'CorrectHorse123' });
      expect(result).toEqual({ mfaRequired: true });
    });

    it('rejects an invalid MFA code', async () => {
      users[0].mfaEnabled = true;
      users[0].mfaSecret = authenticator.generateSecret();

      await expect(
        service.login({ email: 'owner@example.com', password: 'CorrectHorse123', mfaCode: '000000' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('issues tokens when the correct MFA code is given', async () => {
      const secret = authenticator.generateSecret();
      users[0].mfaEnabled = true;
      users[0].mfaSecret = secret;
      const code = authenticator.generate(secret);

      const result = await service.login({ email: 'owner@example.com', password: 'CorrectHorse123', mfaCode: code });
      expect('accessToken' in result).toBe(true);
    });

    it('locks the account after MAX_FAILED_LOGINS wrong-password attempts', async () => {
      for (let i = 0; i < 10; i++) {
        await expect(service.login({ email: 'owner@example.com', password: 'wrong' })).rejects.toThrow(
          UnauthorizedException,
        );
      }
      expect(users[0].lockedUntil).toBeInstanceOf(Date);
      await expect(
        service.login({ email: 'owner@example.com', password: 'CorrectHorse123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('resets failedLoginCount on a successful login', async () => {
      await expect(service.login({ email: 'owner@example.com', password: 'wrong' })).rejects.toThrow();
      expect(users[0].failedLoginCount).toBe(1);
      await service.login({ email: 'owner@example.com', password: 'CorrectHorse123' });
      expect(users[0].failedLoginCount).toBe(0);
    });
  });

  describe('refresh() — rotation and reuse detection', () => {
    it('rotates the refresh token: old one is revoked, a new one is issued', async () => {
      const login: any = await service.login({ email: 'owner@example.com', password: 'CorrectHorse123' });
      expect(refreshTokens).toHaveLength(1);

      const result: any = await service.refresh(login.refreshToken);
      expect(result.refreshToken).not.toBe(login.refreshToken);
      expect(refreshTokens).toHaveLength(2);
      expect(refreshTokens[0].revokedAt).toBeInstanceOf(Date);
      expect(refreshTokens[0].replacedByTokenId).toBe(refreshTokens[1].id);
    });

    it('rejects reuse of an already-rotated (revoked) token and revokes the whole chain', async () => {
      const login: any = await service.login({ email: 'owner@example.com', password: 'CorrectHorse123' });
      const first: any = await service.refresh(login.refreshToken);

      await expect(service.refresh(login.refreshToken)).rejects.toThrow(UnauthorizedException);
      // The second (legitimate) token issued by the rotation above must
      // also be revoked now — reuse detection nukes the whole chain.
      expect(refreshTokens.every((r) => r.revokedAt)).toBe(true);
      await expect(service.refresh(first.refreshToken)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an unknown/never-issued refresh token', async () => {
      await expect(service.refresh('not-a-real-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout()', () => {
    it('revokes the presented refresh token server-side', async () => {
      const login: any = await service.login({ email: 'owner@example.com', password: 'CorrectHorse123' });
      await service.logout(login.refreshToken);
      expect(refreshTokens[0].revokedAt).toBeInstanceOf(Date);
      await expect(service.refresh(login.refreshToken)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('forgotPassword() / resetPassword()', () => {
    it('stores a hashed reset token and lets resetPassword use it once', async () => {
      const result: any = await service.forgotPassword({ email: 'owner@example.com' });
      expect(result.devToken).toEqual(expect.any(String));

      await service.resetPassword({ email: 'owner@example.com', token: result.devToken, newPassword: 'NewPass1234' });

      const passwordValid = await bcrypt.compare('NewPass1234', users[0].passwordHash);
      expect(passwordValid).toBe(true);
      expect(users[0].resetTokenHash).toBeNull();
    });

    it('rejects reset with a wrong token', async () => {
      await service.forgotPassword({ email: 'owner@example.com' });
      await expect(
        service.resetPassword({ email: 'owner@example.com', token: 'not-the-token', newPassword: 'NewPass1234' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects reset once the token has expired', async () => {
      const result: any = await service.forgotPassword({ email: 'owner@example.com' });
      users[0].resetTokenExpiresAt = new Date(Date.now() - 1000);

      await expect(
        service.resetPassword({ email: 'owner@example.com', token: result.devToken, newPassword: 'NewPass1234' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not reveal whether an email exists', async () => {
      const result = await service.forgotPassword({ email: 'nobody@example.com' });
      expect(result.message).toEqual(expect.any(String));
      expect((result as any).devToken).toBeUndefined();
    });
  });

  describe('mfaEnroll() / mfaVerify() / mfaDisable()', () => {
    it('requires a valid code from the just-enrolled secret before enabling MFA', async () => {
      const enrollment = await service.mfaEnroll('user-1');
      expect(enrollment.secret).toEqual(expect.any(String));
      expect(users[0].mfaEnabled).toBe(false);

      const code = authenticator.generate(enrollment.secret);
      await service.mfaVerify('user-1', code);

      expect(users[0].mfaEnabled).toBe(true);
      expect(users[0].mfaSecret).toBe(enrollment.secret);
      expect(users[0].mfaTempSecret).toBeNull();
    });

    it('rejects verify with a bad code and leaves MFA disabled', async () => {
      await service.mfaEnroll('user-1');
      await expect(service.mfaVerify('user-1', '000000')).rejects.toThrow(BadRequestException);
      expect(users[0].mfaEnabled).toBe(false);
    });

    it('disables MFA only with the correct current password', async () => {
      const enrollment = await service.mfaEnroll('user-1');
      await service.mfaVerify('user-1', authenticator.generate(enrollment.secret));

      await expect(service.mfaDisable('user-1', 'wrong-password')).rejects.toThrow(UnauthorizedException);
      expect(users[0].mfaEnabled).toBe(true);

      await service.mfaDisable('user-1', 'CorrectHorse123');
      expect(users[0].mfaEnabled).toBe(false);
      expect(users[0].mfaSecret).toBeNull();
    });
  });
});
