import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { MfaDisableDto } from './dto/mfa-disable.dto';

const REFRESH_COOKIE = 'refresh_token';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  private setRefreshCookie(res: Response, refreshToken: string) {
    // httpOnly so it's never readable from JS (XSS can no longer steal the
    // 7-day-lived refresh token, only whatever short-lived access token is
    // in memory at that moment) — scoped to /auth so it's only ever sent
    // back on the refresh/logout calls that need it.
    res.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto);
    if ('mfaRequired' in result) {
      // No session issued yet — the client resubmits the same login call
      // with mfaCode filled in.
      return result;
    }
    this.setRefreshCookie(res, result.refreshToken);
    // The refresh token is no longer returned in the response body — only
    // the httpOnly cookie carries it now, so it's never JS-readable.
    const { refreshToken, ...body } = result;
    return body;
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('mfa/enroll')
  mfaEnroll(@CurrentUser() user: AuthUser) {
    return this.authService.mfaEnroll(user.userId);
  }

  // A 6-digit TOTP code is brute-forceable (1M possibilities) at the
  // global default of 100 req/min — strictly throttled here the same way
  // login's password check is.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('mfa/verify')
  mfaVerify(@CurrentUser() user: AuthUser, @Body() dto: MfaVerifyDto) {
    return this.authService.mfaVerify(user.userId, dto.code);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('mfa/disable')
  mfaDisable(@CurrentUser() user: AuthUser, @Body() dto: MfaDisableDto) {
    return this.authService.mfaDisable(user.userId, dto.password);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Prefer the httpOnly cookie; fall back to a body-supplied token only
    // for any caller that hasn't migrated yet (e.g. mobile clients without
    // cookie support in the future) — dto.refreshToken is now optional.
    const refreshToken = req.cookies?.[REFRESH_COOKIE] ?? dto.refreshToken;
    const result = await this.authService.refresh(refreshToken);
    this.setRefreshCookie(res, result.refreshToken);
    const { refreshToken: _rt, ...body } = result;
    return body;
  }

  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
  }
}
