import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SafesService } from '../safes/safes.service';
import { ReconciliationsService } from './reconciliations.service';

describe('ReconciliationsService - create()', () => {
  let service: ReconciliationsService;
  let created: any[];

  beforeEach(async () => {
    created = [];
    const prismaMock: any = {
      safe: {
        findUnique: jest.fn(({ where: { id } }: any) =>
          Promise.resolve(id === 'safe-a' ? { id: 'safe-a', name: 'Safe A' } : null),
        ),
      },
      reconciliation: {
        create: jest.fn(({ data }: any) => {
          const row = { id: `r${created.length + 1}`, ...data };
          created.push(row);
          return Promise.resolve(row);
        }),
        findMany: jest.fn(() => Promise.resolve(created)),
      },
    };
    const safesServiceMock = { getBalance: jest.fn(() => Promise.resolve(1000)) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReconciliationsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: SafesService, useValue: safesServiceMock },
      ],
    }).compile();

    service = module.get(ReconciliationsService);
  });

  it('computes expectedBalance from the live safe balance, never from the client', async () => {
    const result = await service.create(
      { safeId: 'safe-a', reconDate: '2024-01-01', actualBalance: 950, note: 'شهري' } as any,
      'user-1',
    );
    expect(result.expectedBalance).toBe(1000);
    expect(result.difference).toBe(-50);
  });

  it('reports a positive difference when actual exceeds expected', async () => {
    const result = await service.create(
      { safeId: 'safe-a', reconDate: '2024-01-01', actualBalance: 1200 } as any,
      'user-1',
    );
    expect(result.difference).toBe(200);
  });

  it('throws NotFoundException for an unknown safe', async () => {
    await expect(
      service.create({ safeId: 'missing-safe', reconDate: '2024-01-01', actualBalance: 100 } as any, 'user-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('findAll() lists reconciliations newest first with the safe relation included', async () => {
    await service.create({ safeId: 'safe-a', reconDate: '2024-01-01', actualBalance: 950 } as any, 'user-1');
    const result = await service.findAll();
    expect(result).toHaveLength(1);
  });
});
