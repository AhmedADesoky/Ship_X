import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { SafesService } from '../safes/safes.service';
import { ImportService } from './import.service';

/**
 * commit()/inspect() are real money-affecting logic (file-hash dedupe,
 * per-row dedupe) that had zero test coverage — this builds a minimal
 * in-memory .xlsx buffer via ExcelJS (no fixture file needed) and exercises
 * both against an in-memory Prisma mock, following this repo's established
 * mocking style.
 */
describe('ImportService', () => {
  let service: ImportService;
  let importBatches: any[];
  let transactions: any[];
  let parties: any[];
  let idCounter: number;

  async function makeWorkbookBuffer(rows: { date: string; description: string; income?: number; expense?: number }[]) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['date', 'description', 'income', 'expense']);
    for (const r of rows) {
      sheet.addRow([r.date, r.description, r.income ?? '', r.expense ?? '']);
    }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  const makePrismaMock = () => {
    const tx = {
      category: { findFirst: jest.fn(() => Promise.resolve(null)) },
      party: {
        findUnique: jest.fn(({ where: { name } }: any) => Promise.resolve(parties.find((p) => p.name === name) ?? null)),
        create: jest.fn(({ data }: any) => {
          const row = { id: `party${parties.length + 1}`, ...data };
          parties.push(row);
          return Promise.resolve(row);
        }),
      },
      transaction: {
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve(
            transactions.find(
              (t) => t.safeId === where.safeId && t.kind === where.kind && Number(t.amount) === Number(where.amount) && t.description === where.description,
            ) ?? null,
          ),
        ),
        create: jest.fn(({ data }: any) => {
          const row = { id: `tx${idCounter++}`, ...data };
          transactions.push(row);
          return Promise.resolve(row);
        }),
      },
      importBatch: {
        update: jest.fn(({ data }: any) => {
          Object.assign(importBatches[0], data);
          return Promise.resolve(importBatches[0]);
        }),
      },
    };
    return {
      $transaction: jest.fn((cb: any) => cb(tx)),
      importBatch: {
        findUnique: jest.fn(({ where: { fileHash } }: any) =>
          Promise.resolve(importBatches.find((b) => b.fileHash === fileHash) ?? null),
        ),
        create: jest.fn(({ data }: any) => {
          const row = { id: `batch${importBatches.length + 1}`, ...data };
          importBatches.push(row);
          return Promise.resolve(row);
        }),
        findMany: jest.fn(() => Promise.resolve(importBatches)),
      },
      safe: {
        findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(id === 'safe-a' ? { id: 'safe-a', name: 'Safe A' } : null)),
      },
    };
  };

  let safesService: { assertSufficientBalance: jest.Mock };

  beforeEach(async () => {
    importBatches = [];
    transactions = [];
    parties = [];
    idCounter = 1;
    // Defaults to "always sufficient" — the dedicated negative-balance
    // test overrides this to actually reject.
    safesService = { assertSufficientBalance: jest.fn(() => Promise.resolve()) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportService,
        { provide: PrismaService, useValue: makePrismaMock() },
        { provide: SafesService, useValue: safesService },
      ],
    }).compile();

    service = module.get(ImportService);
  });

  it('rejects commit() with no default safe', async () => {
    const buffer = await makeWorkbookBuffer([{ date: '2026-01-01', description: 'test', income: 100 }]);
    await expect(
      service.commit({ buffer, originalname: 'x.xlsx' } as any, '', 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects commit() against an unknown safe', async () => {
    const buffer = await makeWorkbookBuffer([{ date: '2026-01-01', description: 'test', income: 100 }]);
    await expect(
      service.commit({ buffer, originalname: 'x.xlsx' } as any, 'missing-safe', 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('imports valid rows and records correct batch totals', async () => {
    const buffer = await makeWorkbookBuffer([
      { date: '2026-01-01', description: 'Row A', income: 500 },
      { date: '2026-01-02', description: 'Row B', expense: 200 },
    ]);

    const result = await service.commit({ buffer, originalname: 'x.xlsx' } as any, 'safe-a', 'user-1');

    expect(result.imported).toBe(2);
    expect(result.incomeTotal).toBe(500);
    expect(result.expenseTotal).toBe(200);
    expect(importBatches[0].status).toBe('COMPLETED');
  });

  it('rejects re-committing a file whose hash already completed', async () => {
    const buffer = await makeWorkbookBuffer([{ date: '2026-01-01', description: 'Row A', income: 500 }]);
    await service.commit({ buffer, originalname: 'x.xlsx' } as any, 'safe-a', 'user-1');

    await expect(
      service.commit({ buffer, originalname: 'x.xlsx' } as any, 'safe-a', 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('per-row dedupe: skips a row matching an existing POSTED transaction on the same safe/kind/amount/description', async () => {
    transactions.push({
      id: 'existing-tx',
      safeId: 'safe-a',
      kind: 'IN',
      amount: 500,
      description: 'Row A',
      status: 'POSTED',
    });

    const buffer = await makeWorkbookBuffer([{ date: '2026-01-01', description: 'Row A', income: 500 }]);
    const result = await service.commit({ buffer, originalname: 'x.xlsx' } as any, 'safe-a', 'user-1');

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('flags a row with no usable date/kind/amount for manual review instead of importing it', async () => {
    const buffer = await makeWorkbookBuffer([{ date: '', description: 'Unusable row' }]);
    const result = await service.commit({ buffer, originalname: 'x.xlsx' } as any, 'safe-a', 'user-1');

    expect(result.imported).toBe(0);
    expect(result.review).toBe(1);
  });

  it('routes an OUT row the safe cannot cover to review instead of importing it or aborting the batch', async () => {
    safesService.assertSufficientBalance.mockRejectedValueOnce(new BadRequestException('رصيد غير كافٍ'));
    const buffer = await makeWorkbookBuffer([
      { date: '2026-01-01', description: 'Too big expense', expense: 5000 },
      { date: '2026-01-02', description: 'Fine income', income: 100 },
    ]);

    const result = await service.commit({ buffer, originalname: 'x.xlsx' } as any, 'safe-a', 'user-1');

    expect(result.review).toBe(1);
    expect(result.imported).toBe(1);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].description).toBe('Fine income');
  });

  it('inspect() reports alreadyImported based on file hash, without committing anything', async () => {
    const buffer = await makeWorkbookBuffer([{ date: '2026-01-01', description: 'Row A', income: 500 }]);
    await service.commit({ buffer, originalname: 'x.xlsx' } as any, 'safe-a', 'user-1');

    const inspected = await service.inspect({ buffer, originalname: 'x.xlsx' } as any);
    expect(inspected.alreadyImported).toBe(true);
    expect(inspected.incomeTotal).toBe(500);
  });

  it('rejects inspect()/commit() with no file', async () => {
    await expect(service.inspect(undefined as any)).rejects.toThrow(BadRequestException);
    await expect(service.commit(undefined as any, 'safe-a', 'user-1')).rejects.toThrow(BadRequestException);
  });
});
