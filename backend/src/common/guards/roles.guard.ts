import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { Role } from '../role-permissions';

/**
 * Global guard that checks the required @Permissions(...) on a route against
 * the current user's effective permissions — their role's defaults plus any
 * per-user extra grants, baked into the JWT at login (see auth.service.ts).
 * Runs after JwtAuthGuard has populated request.user. Routes with no
 * @Permissions metadata are allowed through (still require auth unless also
 * @Public()). Holding ANY ONE of the listed permissions is sufficient (OR
 * semantics — mirrors the frontend's ROUTE_PERMISSIONS OR-list convention,
 * see frontend/lib/permissions.ts). No existing route passes more than one
 * permission today, so this is a pure generalization, not a behavior
 * change for any single-permission route.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as { role?: Role; permissions?: string[] } | undefined;

    if (!user?.role) {
      throw new ForbiddenException('Missing authenticated user role');
    }

    const granted = new Set(user.permissions ?? []);
    const allowed = requiredPermissions.some((permission) => granted.has(permission));
    if (!allowed) {
      throw new ForbiddenException('Insufficient role permissions');
    }
    return true;
  }
}
