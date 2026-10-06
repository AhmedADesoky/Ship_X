import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { SYSTEM_CATEGORIES } from '../src/common/system-categories';

const prisma = new PrismaClient();

// Default safes ported 1:1 from the old app's init_db() seed accounts.
const DEFAULT_SAFES: { name: string; type: string; isMain: boolean }[] = [
  { name: 'خزنة الشركة', type: 'CASH', isMain: true },
  { name: 'فودافون كاش', type: 'OTHER', isMain: false },
  { name: 'الحساب البنكي', type: 'OTHER', isMain: false },
];

// Default categories ported 1:1 from the old app's init_db() seed list
// (app/main.py) so category names/kinds match exactly what existing
// business logic and imports expect. The seven fixed-role categories
// (agent collection, sender, drawing, redeposit, courier sheet
// collection/advance/repayment) live in system-categories.ts — the single
// source of truth shared with resetSystem()'s reseed step. "تحصيل من
// مندوبي القاهرة والجيزة" moved there (systemKey COURIER_SHEET_COLLECTION)
// as part of Phase 24 — it must NOT also be listed here, or a fresh-DB
// seed run would create it twice and violate the name+kind unique index.
const PLAIN_CATEGORIES: { name: string; kind: 'IN' | 'OUT' }[] = [
  { name: 'إيرادات أخرى', kind: 'IN' },
  { name: 'كهرباء', kind: 'OUT' },
  { name: 'مياه', kind: 'OUT' },
  { name: 'صيانة', kind: 'OUT' },
  { name: 'مرتبات', kind: 'OUT' },
  { name: 'إنترنت', kind: 'OUT' },
  { name: 'اشتراك أوليفيري السنوي', kind: 'OUT' },
  { name: 'مصاريف تشغيل أخرى', kind: 'OUT' },
];

async function main() {
  for (const cat of PLAIN_CATEGORIES) {
    await prisma.category.upsert({
      where: { name_kind: { name: cat.name, kind: cat.kind } },
      update: {},
      create: cat,
    });
  }

  // Upsert by systemKey, not name+kind — a system category may already
  // have been renamed by staff on a live DB, and re-running the seed must
  // never overwrite that rename or create a duplicate row under the
  // original default name.
  for (const cat of SYSTEM_CATEGORIES) {
    await prisma.category.upsert({
      where: { systemKey: cat.systemKey },
      update: {},
      create: cat,
    });
  }

  await prisma.appSetting.upsert({
    where: { key: 'company_name' },
    update: {},
    create: { key: 'company_name', value: 'نظام الإدارة المالية' },
  });

  for (const safe of DEFAULT_SAFES) {
    const existing = await prisma.safe.findFirst({ where: { name: safe.name } });
    if (!existing) await prisma.safe.create({ data: safe });
  }

  const ownerEmail = 'ahmedabdlesamad1690@gmail.com';
  const existingOwner = await prisma.user.findUnique({ where: { email: ownerEmail } });
  if (!existingOwner) {
    const password = 'ChangeMe123!';
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: { email: ownerEmail, name: 'Ahmed', role: 'OWNER', passwordHash },
    });
    console.log(`Created OWNER account: ${ownerEmail} / ${password} — change this password after first login.`);
  }

  console.log(
    `Seeded ${PLAIN_CATEGORIES.length + SYSTEM_CATEGORIES.length} categories, ${DEFAULT_SAFES.length} safes, and default app settings.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
