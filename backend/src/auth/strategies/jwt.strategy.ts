import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string;
  email: string;
  role: 'OWNER' | 'MANAGER' | 'ACCOUNTANT' | 'EMPLOYEE';
  // Baked in at login (role defaults + per-user extra grants) so the
  // RolesGuard can check permissions without a DB round trip on every
  // request. A permission change takes effect on the user's next login.
  permissions: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') ?? 'dev-secret-do-not-use-in-production',
    });
  }

  async validate(payload: JwtPayload) {
    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      permissions: payload.permissions ?? [],
    };
  }
}
