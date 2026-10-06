/**
 * Categories with a fixed role in internal flows — identified by
 * `systemKey`, not `name` (a category's display name is user-editable, and
 * matching by name has already silently broken this linkage once on live
 * data). This is the single source of truth for both the initial seed
 * (prisma/seed.ts) and reset reseeding (settings.service.ts's
 * resetSystem()), so the two can never drift out of sync.
 */
export type SystemCategoryKey =
  | 'AGENT_COLLECTION'
  | 'MERCHANT_SENDER'
  | 'MERCHANT_DRAWING'
  | 'MERCHANT_REDEPOSIT'
  | 'COURIER_SHEET_COLLECTION'
  | 'COURIER_ADVANCE'
  | 'COURIER_ADVANCE_REPAYMENT';

export const SYSTEM_CATEGORIES: {
  systemKey: SystemCategoryKey;
  name: string;
  kind: 'IN' | 'OUT';
  // Couriers aren't Party rows, so their categories need no partyType —
  // optional rather than required, unlike the original AGENT/MERCHANT-only
  // entries below.
  partyType?: 'AGENT' | 'MERCHANT';
}[] = [
  { systemKey: 'AGENT_COLLECTION', name: 'تحصيل من وكلاء المحافظات', kind: 'IN', partyType: 'AGENT' },
  { systemKey: 'MERCHANT_SENDER', name: 'رواسل', kind: 'OUT', partyType: 'MERCHANT' },
  { systemKey: 'MERCHANT_DRAWING', name: 'مسحوبات', kind: 'OUT', partyType: 'MERCHANT' },
  { systemKey: 'MERCHANT_REDEPOSIT', name: 'إعادة إدخال مبلغ مسحوب', kind: 'IN', partyType: 'MERCHANT' },
  { systemKey: 'COURIER_SHEET_COLLECTION', name: 'تحصيل شيتات مناديب القاهرة والجيزة', kind: 'IN' },
  { systemKey: 'COURIER_ADVANCE', name: 'سلفة مناديب', kind: 'OUT' },
  { systemKey: 'COURIER_ADVANCE_REPAYMENT', name: 'توريد سلفة مناديب', kind: 'IN' },
];
