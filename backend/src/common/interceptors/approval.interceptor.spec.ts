import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { ApprovalInterceptor } from './approval.interceptor';
import { REQUIRES_APPROVAL_KEY } from '../decorators/requires-approval.decorator';

describe('ApprovalInterceptor', () => {
  let prisma: any;
  let pendingActions: any[];

  const makeInterceptor = (requiresApproval: boolean) => {
    const reflector = { getAllAndOverride: jest.fn(() => requiresApproval) } as unknown as Reflector;
    return new ApprovalInterceptor(reflector, prisma);
  };

  const makeContext = (user: any, overrides: any = {}) => ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'DELETE',
        url: '/parties/party-1',
        route: { path: '/parties/:id' },
        params: { id: 'party-1' },
        body: {},
        user,
        ...overrides,
      }),
    }),
  });

  beforeEach(() => {
    pendingActions = [];
    prisma = {
      pendingAction: {
        create: jest.fn(({ data }: any) => {
          const row = { id: `pa${pendingActions.length + 1}`, ...data };
          pendingActions.push(row);
          return Promise.resolve(row);
        }),
      },
    };
  });

  it('passes through untouched when the route does not require approval', async () => {
    const interceptor = makeInterceptor(false);
    const handler = { handle: () => of({ deleted: true }) };
    const result = await firstValueFrom(
      interceptor.intercept(makeContext({ userId: 'u1', role: 'EMPLOYEE' }) as any, handler as any),
    );
    expect(result).toEqual({ deleted: true });
    expect(pendingActions).toHaveLength(0);
  });

  it('queues the request instead of executing it for an EMPLOYEE on a gated route', async () => {
    const interceptor = makeInterceptor(true);
    const handler = { handle: jest.fn(() => of({ deleted: true })) };
    const result: any = await firstValueFrom(
      interceptor.intercept(makeContext({ userId: 'u1', role: 'EMPLOYEE' }) as any, handler as any),
    );

    expect(result.queued).toBe(true);
    expect(pendingActions).toHaveLength(1);
    expect(pendingActions[0]).toMatchObject({ actorId: 'u1', method: 'DELETE', route: 'parties/:id', entityId: 'party-1' });
    // The real handler must never have run for a queued request.
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('bypasses the queue for OWNER/MANAGER/ACCOUNTANT even on a gated route', async () => {
    const interceptor = makeInterceptor(true);
    const handler = { handle: () => of({ deleted: true }) };
    const result = await firstValueFrom(
      interceptor.intercept(makeContext({ userId: 'u2', role: 'OWNER' }) as any, handler as any),
    );
    expect(result).toEqual({ deleted: true });
    expect(pendingActions).toHaveLength(0);
  });

  it('bypasses the queue when there is no authenticated user', async () => {
    const interceptor = makeInterceptor(true);
    const handler = { handle: () => of({ deleted: true }) };
    const result = await firstValueFrom(interceptor.intercept(makeContext(undefined) as any, handler as any));
    expect(result).toEqual({ deleted: true });
    expect(pendingActions).toHaveLength(0);
  });
});
