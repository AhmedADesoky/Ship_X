/**
 * Pure, dependency-free ports of the old app's Excel-import heuristics
 * (app/main.py: HEADER_ALIASES, norm/guess, valnum, dateval, and the
 * kind/category/party inference inside commit_excel()). Kept separate from
 * exceljs/Prisma so they can be unit tested directly.
 */

export const HEADER_ALIASES: Record<string, string[]> = {
  date: ['date', 'التاريخ', 'تاريخ', 'يوم'],
  time: ['time', 'الوقت'],
  description: ['description', 'البيان', 'بيان', 'الوصف', 'التفاصيل', 'تفاصيل'],
  income: ['income', 'داخل', 'الداخل', 'قبض', 'إيراد', 'مدين'],
  expense: ['expense', 'out', 'خارج', 'الخارج', 'مصروف', 'دائن'],
  amount: ['amount', 'المبلغ', 'القيمة', 'value'],
  category: ['category', 'البند', 'نوع العملية', 'التصنيف'],
  account: ['account', 'الحساب', 'الخزنة', 'طريقة الدفع'],
  party: ['party', 'الجهة', 'الراسل', 'الوكيل', 'اسم العميل'],
  province: ['province', 'المحافظة'],
};

/** Strips everything but word chars + Arabic letters, lowercases. */
export function normalizeHeader(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\w؀-ۿ]+/g, '');
}

/** Finds the best-matching header for a HEADER_ALIASES key, or null. */
export function guessHeader(headers: string[], key: keyof typeof HEADER_ALIASES): string | null {
  const aliases = HEADER_ALIASES[key];
  const normalizedHeaders = new Map(headers.map((h) => [normalizeHeader(h), h]));
  for (const alias of aliases) {
    const n = normalizeHeader(alias);
    if (normalizedHeaders.has(n)) return normalizedHeaders.get(n)!;
  }
  for (const h of headers) {
    const nh = normalizeHeader(h);
    if (aliases.some((a) => nh.includes(normalizeHeader(a)) || normalizeHeader(a).includes(nh))) return h;
  }
  return null;
}

/** Parses a numeric cell value, tolerating currency text/commas (valnum). */
export function valnum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v)
    .replace(/,/g, '')
    .replace(/٬/g, '')
    .replace(/جنيه/g, '')
    .replace(/EGP/gi, '')
    .trim();
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

const DATE_FORMATS: Array<(s: string) => string | null> = [
  (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null),
  (s) => {
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  },
  (s) => {
    const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (!m) return null;
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  },
  (s) => {
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
    if (!m) return null;
    const [, d, mo, y] = m;
    return `20${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  },
];

/** Parses a date cell (Date object, ISO string, or dd/mm/yyyy-family) -> 'YYYY-MM-DD' or ''. */
export function dateval(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  if (!s) return '';
  for (const parser of DATE_FORMATS) {
    const result = parser(s);
    if (result) return result;
  }
  return '';
}

export type Kind = 'IN' | 'OUT' | '';

/** kind inference: income>0 & expense<=0 -> IN; expense>0 & income<=0 -> OUT; else needs-review ('') */
export function inferKind(income: number, expense: number): Kind {
  if (income > 0 && expense <= 0) return 'IN';
  if (expense > 0 && income <= 0) return 'OUT';
  return '';
}

const AGENT_KEYWORDS = ['وكيل', 'مندوب', 'agent', 'courier'];
const MERCHANT_KEYWORDS = ['راسل', 'تاجر', 'merchant', 'sender'];

/** Party-name inference from description keywords when no dedicated party column exists. */
export function inferPartyFromDescription(kind: Kind, description: string): string {
  if (kind === 'IN' && AGENT_KEYWORDS.some((w) => description.includes(w))) return description;
  if (kind === 'OUT' && MERCHANT_KEYWORDS.some((w) => description.includes(w))) return description;
  return '';
}

export function inferPartyType(kind: Kind): 'AGENT' | 'MERCHANT' {
  return kind === 'IN' ? 'AGENT' : 'MERCHANT';
}

/**
 * Category inference fallback (kind must already be IN/OUT): checks the
 * category/description text for keyword hints, else falls back to the
 * generic catch-all categories, matching commit_excel()'s heuristic chain.
 */
export function inferCategoryName(kind: 'IN' | 'OUT', categoryText: string, description: string, hasProvinceColumn: boolean, partyText: string): string {
  const haystack = `${categoryText} ${description}`;
  if (kind === 'IN') {
    if (partyText.includes('وكيل') || hasProvinceColumn) return 'تحصيل من وكلاء المحافظات';
    return 'تحصيل شيتات مناديب القاهرة والجيزة';
  }
  if (haystack.includes('كهرب')) return 'كهرباء';
  if (haystack.includes('مياه')) return 'مياه';
  if (haystack.includes('مرتب')) return 'مرتبات';
  if (haystack.includes('نت')) return 'إنترنت';
  if (haystack.includes('أوليف')) return 'اشتراك أوليفيري السنوي';
  return 'مصاريف تشغيل أخرى';
}

/** Header-row auto-detection: first row (of the first 20) with >= 2 non-empty cells. */
export function detectHeaderRowIndex(rows: unknown[][], scanLimit = 20): number {
  const limit = Math.min(rows.length, scanLimit);
  for (let i = 0; i < limit; i++) {
    const nonEmpty = rows[i].filter((cell) => cell !== null && cell !== undefined && cell !== '').length;
    if (nonEmpty >= 2) return i;
  }
  return 0;
}

/** Per-row dedupe fingerprint: exact match on date/kind/amount/safeId/description. */
export function rowFingerprint(fields: {
  date: string;
  kind: string;
  amount: number;
  safeId: string;
  description: string;
}): string {
  return [fields.date, fields.kind, fields.amount.toFixed(2), fields.safeId, fields.description ?? ''].join('|');
}
