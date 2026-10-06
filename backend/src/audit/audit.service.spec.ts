import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

describe('AuditService - findAll()', () => {
  let service: AuditService;
  let findManyMock: jest.Mock;

  beforeEach(async () => {
    findManyMock = jest.fn(() => Promise.resolve([]));
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: { auditLog: { findMany: findManyMock } } }],
    }).compile();
    service = module.get(AuditService);
  });

  it('applies default pagination when none is given', async () => {
    await service.findAll();
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 50, where: {} }),
    );
  });

  it('computes skip from page/pageSize', async () => {
    await service.findAll(3, 20);
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ skip: 40, take: 20 }));
  });

  it('filters by actorId and entityType', async () => {
    await service.findAll(1, 50, { actorId: 'user-1', entityType: 'safes' });
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { actorId: 'user-1', entityType: 'safes' } }),
    );
  });

  it('filters by a from/to date range', async () => {
    await service.findAll(1, 50, { from: '2026-01-01', to: '2026-01-31' });
    const call = findManyMock.mock.calls[0][0];
    expect(call.where.createdAt.gte).toEqual(new Date('2026-01-01'));
    expect(call.where.createdAt.lte).toEqual(new Date('2026-01-31'));
  });

  it('includes the actor relation, ordered newest first', async () => {
    await service.findAll();
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { id: true, name: true, email: true } } },
      }),
    );
  });
});
