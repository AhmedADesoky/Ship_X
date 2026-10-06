import { of, throwError, firstValueFrom } from 'rxjs';
import { ForbiddenException } from '@nestjs/common';
import { AuditInterceptor } from './audit.interceptor';

describe('AuditInterceptor', () => {
  let logs: any[];
  let prisma: any;
  let interceptor: AuditInterceptor;

  beforeEach(() => {
    logs = [];
    prisma = {
      auditLog: {
        create: jest.fn(({ data }: any) => {
          logs.push(data);
          return Promise.resolve(data);
        }),
      },
    };
    interceptor = new AuditInterceptor(prisma);
  });

  const makeContext = (overrides: any = {}) => ({
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        url: '/safes',
        route: { path: '/safes' },
        params: {},
        body: { name: 'Test Safe' },
        user: { userId: 'user-1' },
        ...overrides,
      }),
    }),
  });

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('logs a successful mutating request with statusCode null', async () => {
    const handler = { handle: () => of({ id: 'safe-1', name: 'Test Safe' }) };
    await firstValueFrom(interceptor.intercept(makeContext() as any, handler as any));
    await flush();

    expect(logs).toHaveLength(1);
    expect(logs[0].statusCode).toBeNull();
    expect(logs[0].actorId).toBe('user-1');
  });

  it('logs a rejected mutating request with the real status code, and still propagates the error', async () => {
    const handler = { handle: () => throwError(() => new ForbiddenException('nope')) };

    await expect(firstValueFrom(interceptor.intercept(makeContext() as any, handler as any))).rejects.toThrow(
      'nope',
    );
    await flush();

    expect(logs).toHaveLength(1);
    expect(logs[0].statusCode).toBe(403);
  });

  it('does not log non-mutating (GET) requests', async () => {
    const handler = { handle: () => of([{ id: 'safe-1' }]) };
    const context = makeContext({ method: 'GET' });
    await firstValueFrom(interceptor.intercept(context as any, handler as any));
    await flush();

    expect(logs).toHaveLength(0);
  });
});
