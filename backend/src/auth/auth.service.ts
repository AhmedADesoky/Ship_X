import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { authenticator } from 'otplib';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { effectivePermissions, Role } from '../common/role-permissions';

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 10;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

// Minimal duration-string parser for JWT_REFRESH_EXPIRES_IN-style values
// ("7d", "15m", "1h") — used to compute the RefreshToken row's expiresAt,
// which must match the JWT's own expiry so the DB row and the token agree.
function parseDurationMs(input: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)$/.exec(input.trim());
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const unitMs: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * unitMs[match[2]];
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async issueRefreshToken(payload: Record<string, unknown>, userId: string) {
    const expiresIn = this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';
    // jti guarantees two tokens for the same user are never byte-identical
    // even if issued within the same second (JWT `iat` is second-
    // resolution) — without it, login immediately followed by refresh can
    // sign the exact same payload twice, producing identical token
    // strings and colliding on RefreshToken.tokenHash's unique constraint.
    const refreshToken = this.jwt.sign(
      { ...payload, jti: crypto.randomUUID() },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET') ?? 'dev-refresh-secret-do-not-use-in-production',
        expiresIn: expiresIn as import('ms').StringValue,
      },
    );
    const row = await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + parseDurationMs(expiresIn)),
      },
    });
    return { refreshToken, row };
  }

  /**
   * Local auth is the real, owned auth provider (not a placeholder pending
   * Supabase Auth) — passwords are bcrypt-hashed at rest (users.service.ts),
   * sessions are short-lived JWTs with an httpOnly-cookie refresh token
   * (auth.controller.ts), and this class also owns password reset
   * (forgotPassword/resetPassword below) and optional TOTP MFA (mfa* below
   * and login()'s second-factor branch).
   */
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    if (!user || !user.active || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Account-level lockout — complements the IP-based @Throttle on this
    // route, which a distributed attacker (many IPs) can otherwise ignore.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account temporarily locked due to repeated failed logins. Try again later.');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      const failedLoginCount = user.failedLoginCount + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount,
          lockedUntil: failedLoginCount >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_DURATION_MS) : undefined,
        },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.mfaEnabled && user.mfaSecret) {
      // Password alone is correct but a second factor is required — never
      // issue any session token yet. The client resubmits the exact same
      // login call with mfaCode filled in.
      if (!dto.mfaCode) {
        return { mfaRequired: true };
      }
      const codeValid = authenticator.check(dto.mfaCode, user.mfaSecret);
      if (!codeValid) {
        throw new UnauthorizedException('Invalid authentication code');
      }
    }

    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    }

    const extraGrants = await this.prisma.rolePermission.findMany({
      where: { userId: user.id },
      select: { permission: true },
    });
    const permissions = effectivePermissions(
      user.role as Role,
      extraGrants.map((g) => g.permission),
    );

    const payload = { sub: user.id, email: user.email, role: user.role, permissions };

    const accessToken = this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_SECRET') ?? 'dev-secret-do-not-use-in-production',
      expiresIn: (this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m') as import('ms').StringValue,
    });
    const { refreshToken } = await this.issueRefreshToken(payload, user.id);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        title: user.title,
        avatarUrl: user.avatarUrl,
        permissions,
        mfaEnabled: user.mfaEnabled,
      },
    };
  }

  /**
   * Verifies a previously-issued refresh token, rotates it (the presented
   * token is revoked and a brand-new one issued), and re-issues a fresh
   * access token the same way login() does. The JWT's own signature/exp is
   * checked first as a cheap early reject, but the RefreshToken DB row is
   * the actual source of truth for validity — this is what makes
   * server-side revocation (logout, reuse detection) possible at all,
   * which a JWT-only scheme structurally cannot do.
   *
   * Reuse detection: if the presented token's row is already revoked, it's
   * either a replay of an old token after a legitimate rotation (benign —
   * a slow client retry) or a stolen token racing the real owner
   * (malicious). Since the two can't be told apart from the server side,
   * the safe response is the same either way: revoke every other live
   * token for this user and force a full re-login.
   */
  async refresh(refreshToken: string | undefined) {
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }
    let decoded: { sub: string };
    try {
      decoded = this.jwt.verify(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET') ?? 'dev-refresh-secret-do-not-use-in-production',
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const tokenHash = this.hashToken(refreshToken);
    const tokenRow = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!tokenRow || tokenRow.userId !== decoded.sub || tokenRow.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (tokenRow.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: tokenRow.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reuse detected — all sessions have been signed out');
    }

    const user = await this.prisma.user.findUnique({ where: { id: decoded.sub } });
    if (!user || !user.active) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const extraGrants = await this.prisma.rolePermission.findMany({
      where: { userId: user.id },
      select: { permission: true },
    });
    const permissions = effectivePermissions(
      user.role as Role,
      extraGrants.map((g) => g.permission),
    );

    const payload = { sub: user.id, email: user.email, role: user.role, permissions };

    const accessToken = this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_SECRET') ?? 'dev-secret-do-not-use-in-production',
      expiresIn: (this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m') as import('ms').StringValue,
    });
    const { refreshToken: newRefreshToken, row: newRow } = await this.issueRefreshToken(payload, user.id);
    await this.prisma.refreshToken.update({
      where: { id: tokenRow.id },
      data: { revokedAt: new Date(), replacedByTokenId: newRow.id },
    });

    return {
      accessToken,
      refreshToken: newRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        title: user.title,
        avatarUrl: user.avatarUrl,
        permissions,
        mfaEnabled: user.mfaEnabled,
      },
    };
  }

  /** Revokes the presented refresh token server-side — closes the "stolen
   * token still valid until natural expiry after explicit logout" gap. */
  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return;
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Always responds the same way regardless of whether the email exists,
   * so this endpoint can't be used to enumerate registered accounts. Only
   * a bcrypt hash of the reset token is ever stored — the plaintext token
   * exists only in this response, which in a real deployment would be
   * emailed rather than returned to the caller (no SMTP/email provider is
   * wired up yet, so it's returned directly here and logged server-side;
   * see the TODO below).
   */
  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    const generic = { message: 'If that account exists, a password reset link has been issued.' };

    if (!user || !user.active) return generic;

    const token = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = await bcrypt.hash(token, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { resetTokenHash, resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
    });

    // TODO(email): no email provider is configured yet — wire this to a
    // real transactional-email send (e.g. via Supabase, SES, Resend) before
    // production use. Until then the token is only visible in this server
    // log, so resets must be coordinated out-of-band (an admin reading the
    // backend log) rather than via a real emailed link.
    console.log(`[password-reset] ${user.email} token=${token} (expires in 15m)`);

    return process.env.NODE_ENV === 'production' ? generic : { ...generic, devToken: token };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.active || !user.resetTokenHash || !user.resetTokenExpiresAt) {
      throw new BadRequestException('Invalid or expired reset token');
    }
    if (user.resetTokenExpiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }
    const tokenValid = await bcrypt.compare(dto.token, user.resetTokenHash);
    if (!tokenValid) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetTokenHash: null, resetTokenExpiresAt: null },
    });

    return { message: 'Password updated. Please log in with your new password.' };
  }

  /**
   * Generates a new TOTP secret and stashes it as mfaTempSecret (not yet
   * trusted/active) until the user proves possession of it via mfaVerify —
   * this stops a login-session hijack from silently turning MFA on with a
   * secret the real user never saw.
   */
  async mfaEnroll(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const secret = authenticator.generateSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { mfaTempSecret: secret } });

    const otpauthUrl = authenticator.keyuri(user.email, 'Ship X Finance', secret);
    return { secret, otpauthUrl };
  }

  async mfaVerify(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaTempSecret) {
      throw new BadRequestException('No MFA enrollment in progress — call /auth/mfa/enroll first');
    }
    if (!authenticator.check(code, user.mfaTempSecret)) {
      throw new BadRequestException('Invalid authentication code');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true, mfaSecret: user.mfaTempSecret, mfaTempSecret: null },
    });
    return { mfaEnabled: true };
  }

  async mfaDisable(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) throw new UnauthorizedException();
    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) throw new UnauthorizedException('Invalid credentials');

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecret: null, mfaTempSecret: null },
    });
    return { mfaEnabled: false };
  }
}
