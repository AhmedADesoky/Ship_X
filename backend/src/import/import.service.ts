import { BadRequestException, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { SafesService } from '../safes/safes.service';
import {
  dateval,
  detectHeaderRowIndex,
  guessHeader,
  HEADER_ALIASES,
  inferCategoryName,
  inferKind,
  inferPartyFromDescription,
  inferPartyType,
  rowFingerprint,
  valnum,
} from './import-heuristics';

interface ParsedRow {
  sheet: string;
  data: Record<string, unknown>;
}

@Injectable()
export class ImportService {
  constructor(
    private prisma: PrismaService,
    private safes: SafesService,
  ) {}

  private async parseWorkbook(buffer: Buffer): Promise<{ sheets: { name: string; rows: number; headers: string[] }[]; rows: ParsedRow[] }> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const sheets: { name: string; rows: number; headers: string[] }[] = [];
    const rows: ParsedRow[] = [];

    workbook.eachSheet((worksheet) => {
      const allRows: unknown[][] = [];
      worksheet.eachRow({ includeEmpty: true }, (row) => {
        const values = (row.values as unknown[]).slice(1); // exceljs is 1-indexed with a leading undefined
        allRows.push(values);
      });
      if (allRows.length === 0) return;

      const headerIndex = detectHeaderRowIndex(allRows);
      const headerRow = allRows[headerIndex] ?? [];
      const headers = headerRow.map((cell, i) => (cell !== null && cell !== undefined && cell !== '' ? String(cell).trim() : `Column ${i + 1}`));

      const dataRows = allRows.slice(headerIndex + 1).filter((r) => r.some((c) => c !== null && c !== undefined && c !== ''));
      for (const r of dataRows) {
        const d: Record<string, unknown> = {};
        headers.forEach((h, i) => (d[h] = r[i]));
        rows.push({ sheet: worksheet.name, data: d });
      }
      sheets.push({ name: worksheet.name, rows: dataRows.length, headers });
    });

    return { sheets, rows };
  }

  private buildMapping(rows: ParsedRow[]) {
    const headerSet = new Set<string>();
    for (const r of rows) Object.keys(r.data).forEach((h) => headerSet.add(h));
    const headers = [...headerSet];
    const mapping: Record<string, string | null> = {};
    for (const key of Object.keys(HEADER_ALIASES)) {
      mapping[key] = guessHeader(headers, key as keyof typeof HEADER_ALIASES);
    }
    return mapping;
  }

  async inspect(file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const { sheets, rows } = await this.parseWorkbook(file.buffer);
    const mapping = this.buildMapping(rows);

    const sample = rows.slice(0, 25).map((r) => ({
      sheet: r.sheet,
      date: mapping.date ? dateval(r.data[mapping.date]) : '',
      description: mapping.description ? String(r.data[mapping.description] ?? '') : '',
      income: mapping.income ? valnum(r.data[mapping.income]) : 0,
      expense: mapping.expense ? valnum(r.data[mapping.expense]) : 0,
      amount: mapping.amount ? valnum(r.data[mapping.amount]) : 0,
    }));

    const incomeTotal = mapping.income ? rows.reduce((sum, r) => sum + valnum(r.data[mapping.income!]), 0) : 0;
    const expenseTotal = mapping.expense ? rows.reduce((sum, r) => sum + valnum(r.data[mapping.expense!]), 0) : 0;

    const existingBatch = await this.prisma.importBatch.findUnique({ where: { fileHash: hash } });

    return {
      filename: file.originalname,
      hash,
      sheets,
      rows: rows.length,
      mapping,
      sample,
      incomeTotal,
      expenseTotal,
      warnings: mapping.date ? [] : ['لم يتم العثور على عمود تاريخ واضح'],
      alreadyImported: !!existingBatch,
    };
  }

  async commit(file: Express.Multer.File, defaultSafeId: string, createdById: string | undefined) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!defaultSafeId) throw new BadRequestException('يجب اختيار خزنة افتراضية');

    const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.prisma.importBatch.findUnique({ where: { fileHash: hash } });
    if (existing && existing.status === 'COMPLETED') {
      throw new BadRequestException('هذا الملف تم استيراده بالفعل. استخدم نسخة مختلفة أو راجع سجل الاستيراد.');
    }

    const safe = await this.prisma.safe.findUnique({ where: { id: defaultSafeId } });
    if (!safe) throw new BadRequestException('الخزنة الافتراضية غير موجودة');

    const { rows } = await this.parseWorkbook(file.buffer);
    const mapping = this.buildMapping(rows);

    const batch = await this.prisma.importBatch.create({
      data: { filename: file.originalname, fileHash: hash, status: 'RUNNING', createdById },
    });

    let imported = 0;
    let skipped = 0;
    let review = 0;
    let incomeTotal = 0;
    let expenseTotal = 0;

    try {
      await this.prisma.$transaction(async (tx) => {
        for (const row of rows) {
          const dt = mapping.date ? dateval(row.data[mapping.date]) : '';
          const income = mapping.income ? valnum(row.data[mapping.income]) : 0;
          const expense = mapping.expense ? valnum(row.data[mapping.expense]) : 0;
          const amount = mapping.amount ? valnum(row.data[mapping.amount]) : 0;
          const kind = inferKind(income, expense);
          const finalAmount = income || expense || amount;
          const description = mapping.description ? String(row.data[mapping.description] ?? '') : '';

          if (!dt || !kind || finalAmount <= 0) {
            review += 1;
            continue;
          }

          const categoryText = mapping.category ? String(row.data[mapping.category] ?? '').trim() : '';
          let partyText = mapping.party ? String(row.data[mapping.party] ?? '').trim() : '';
          if (!partyText) partyText = inferPartyFromDescription(kind, description);

          let category = categoryText
            ? await tx.category.findFirst({ where: { active: true, kind, name: categoryText } })
            : null;
          if (!category) {
            const categoryName = inferCategoryName(kind, categoryText, description, !!mapping.province, partyText);
            category = await tx.category.findFirst({ where: { name: categoryName, kind } });
          }

          let partyId: string | null = null;
          if (partyText) {
            const partyType = inferPartyType(kind);
            const existingParty = await tx.party.findUnique({ where: { name: partyText } });
            if (!existingParty) {
              const province = mapping.province ? String(row.data[mapping.province] ?? '') : '';
              const created = await tx.party.create({ data: { name: partyText, partyType, province } });
              partyId = created.id;
            } else if (existingParty.partyType === partyType) {
              partyId = existingParty.id;
            }
          }

          // Per-row dedupe fingerprint against existing POSTED transactions.
          const fingerprint = rowFingerprint({ date: dt, kind, amount: finalAmount, safeId: defaultSafeId, description });
          const dup = await tx.transaction.findFirst({
            where: {
              safeId: defaultSafeId,
              kind: kind as any,
              amount: finalAmount,
              description,
              status: 'POSTED',
              createdAt: { gte: new Date(dt), lt: new Date(new Date(dt).getTime() + 86400000) },
            },
          });
          if (dup) {
            skipped += 1;
            continue;
          }
          void fingerprint; // fingerprint also documents the intended dedupe key shape for tests

          // Balance can never go negative — an expense row the running
          // (within-this-import) balance can't cover is routed to "needs
          // review" rather than aborting the whole batch, consistent with
          // how an unparseable row is already handled above. Checked
          // against `tx` so it sees every row already imported earlier in
          // this same batch, not just the pre-import balance.
          if (kind === 'OUT') {
            try {
              await this.safes.assertSufficientBalance(defaultSafeId, finalAmount, tx as any);
            } catch {
              review += 1;
              continue;
            }
          }

          await tx.transaction.create({
            data: {
              kind: kind as any,
              amount: finalAmount,
              safeId: defaultSafeId,
              categoryId: category?.id,
              partyId: partyId ?? undefined,
              description,
              notes: `مستورد من ${row.sheet}`,
              status: 'POSTED',
              importBatchId: batch.id,
              createdById,
              createdAt: new Date(dt),
            },
          });
          imported += 1;
          if (kind === 'IN') incomeTotal += finalAmount;
          else expenseTotal += finalAmount;
        }

        await tx.importBatch.update({
          where: { id: batch.id },
          data: {
            status: 'COMPLETED',
            rowsRead: rows.length,
            rowsImported: imported,
            rowsSkipped: skipped,
            rowsReview: review,
            incomeTotal,
            expenseTotal,
            completedAt: new Date(),
          },
        });
      });
    } catch (err) {
      await this.prisma.importBatch.update({
        where: { id: batch.id },
        data: { status: 'FAILED', notes: 'تم إلغاء الاستيراد بسبب خطأ.', completedAt: new Date() },
      });
      throw err;
    }

    return { batchId: batch.id, rowsRead: rows.length, imported, skipped, review, incomeTotal, expenseTotal };
  }

  history() {
    return this.prisma.importBatch.findMany({ orderBy: { startedAt: 'desc' } });
  }
}
