import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

/**
 * Phase 37: RolesGuard's @Permissions(...) check is OR (holding ANY ONE of
 * the listed permissions is sufficient), not AND — mirrors the frontend's
 * ROUTE_PERMISSIONS OR-list convention. For a single-permission route
 * (every route in this app until this phase), OR and AND are equivalent,
 * so this also proves the change is a no-op for existing routes.
 */
describe('RolesGuard', () => {
  function makeContext(user: { role?: string; permissions?: string[] } | undefined) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  function makeGuard(requiredPermissions: string[] | undefined) {
    const reflector = {
      getAllAndOverride: jest.fn(() => requiredPermissions),
    } as unknown as Reflector;
    return new RolesGuard(reflector);
  }

  it('allows a request when no @Permissions metadata is present', () => {
    const guard = makeGuard(undefined);
    expect(guard.canActivate(makeContext({ role: 'EMPLOYEE', permissions: [] }))).toBe(true);
  });

  it('single-permission route: allows a user who holds exactly that permission', () => {
    const guard = makeGuard(['view_reports']);
    expect(guard.canActivate(makeContext({ role: 'EMPLOYEE', permissions: ['view_reports'] }))).toBe(true);
  });

  it('single-permission route: rejects a user who lacks it', () => {
    const guard = makeGuard(['view_reports']);
    expect(() => guard.canActivate(makeContext({ role: 'EMPLOYEE', permissions: ['manage_transactions'] }))).toThrow(
      ForbiddenException,
    );
  });

  it('multi-permission route: allows a user holding ANY ONE of the listed permissions (OR)', () => {
    const guard = makeGuard(['view_reports', 'edit_transactions', 'manage_transactions']);
    expect(
      guard.canActivate(makeContext({ role: 'EMPLOYEE', permissions: ['manage_transactions'] })),
    ).toBe(true);
  });

  it('multi-permission route: rejects a user holding none of the listed permissions', () => {
    const guard = makeGuard(['view_reports', 'edit_transactions', 'manage_transactions']);
    expect(() =>
      guard.canActivate(makeContext({ role: 'EMPLOYEE', permissions: ['manage_categories'] })),
    ).toThrow(ForbiddenException);
  });

  it('throws when there is no authenticated user/role', () => {
    const guard = makeGuard(['view_reports']);
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });
});
