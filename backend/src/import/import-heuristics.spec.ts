import {
  dateval,
  detectHeaderRowIndex,
  guessHeader,
  inferCategoryName,
  inferKind,
  inferPartyFromDescription,
  normalizeHeader,
  rowFingerprint,
  valnum,
} from './import-heuristics';

describe('import heuristics', () => {
  describe('normalizeHeader / guessHeader', () => {
    it('maps bilingual header aliases to the canonical column', () => {
      const headers = ['التاريخ', 'البيان', 'الداخل', 'الخارج', 'البند'];
      expect(guessHeader(headers, 'date')).toBe('التاريخ');
      expect(guessHeader(headers, 'description')).toBe('البيان');
      expect(guessHeader(headers, 'income')).toBe('الداخل');
      expect(guessHeader(headers, 'expense')).toBe('الخارج');
      expect(guessHeader(headers, 'category')).toBe('البند');
    });

    it('returns null when no alias matches', () => {
      expect(guessHeader(['Random Column'], 'party')).toBeNull();
    });

    it('normalizes whitespace/case/punctuation', () => {
      expect(normalizeHeader(' Date ')).toBe('date');
      expect(normalizeHeader('Column 1')).toBe('column1');
    });
  });

  describe('valnum', () => {
    it('parses plain numbers and currency-formatted strings', () => {
      expect(valnum(500)).toBe(500);
      expect(valnum('1,250.50')).toBe(1250.5);
      expect(valnum('500 جنيه')).toBe(500);
      expect(valnum('500 EGP')).toBe(500);
      expect(valnum('')).toBe(0);
      expect(valnum(null)).toBe(0);
      expect(valnum('not a number')).toBe(0);
    });
  });

  describe('dateval', () => {
    it('parses a Date object', () => {
      expect(dateval(new Date('2024-03-15T00:00:00Z'))).toBe('2024-03-15');
    });
    it('parses ISO and dd/mm/yyyy-family strings', () => {
      expect(dateval('2024-03-15')).toBe('2024-03-15');
      expect(dateval('15/03/2024')).toBe('2024-03-15');
      expect(dateval('15-03-2024')).toBe('2024-03-15');
      expect(dateval('15/03/24')).toBe('2024-03-15');
    });
    it('returns empty string for unparseable input', () => {
      expect(dateval('not a date')).toBe('');
      expect(dateval(undefined)).toBe('');
    });
  });

  describe('inferKind', () => {
    it('infers IN when only income is positive', () => {
      expect(inferKind(500, 0)).toBe('IN');
    });
    it('infers OUT when only expense is positive', () => {
      expect(inferKind(0, 300)).toBe('OUT');
    });
    it('needs review when both or neither are positive', () => {
      expect(inferKind(0, 0)).toBe('');
      expect(inferKind(100, 100)).toBe('');
    });
  });

  describe('inferPartyFromDescription', () => {
    it('infers an AGENT candidate on IN rows with agent keywords', () => {
      expect(inferPartyFromDescription('IN', 'تحصيل وكيل الاسكندرية')).toBe('تحصيل وكيل الاسكندرية');
      expect(inferPartyFromDescription('IN', 'دفعة من العميل')).toBe('');
    });
    it('infers a MERCHANT candidate on OUT rows with merchant keywords', () => {
      expect(inferPartyFromDescription('OUT', 'تحويل لتاجر المنصورة')).toBe('تحويل لتاجر المنصورة');
      expect(inferPartyFromDescription('OUT', 'فاتورة كهرباء')).toBe('');
    });
  });

  describe('inferCategoryName', () => {
    it('routes IN rows to agent vs. Cairo/Giza rep categories', () => {
      expect(inferCategoryName('IN', '', '', false, 'وكيل الاسكندرية')).toBe('تحصيل من وكلاء المحافظات');
      expect(inferCategoryName('IN', '', '', true, '')).toBe('تحصيل من وكلاء المحافظات');
      expect(inferCategoryName('IN', '', '', false, '')).toBe('تحصيل شيتات مناديب القاهرة والجيزة');
    });
    it('routes OUT rows via utility keyword fallback', () => {
      expect(inferCategoryName('OUT', '', 'فاتورة كهرباء', false, '')).toBe('كهرباء');
      expect(inferCategoryName('OUT', '', 'فاتورة مياه', false, '')).toBe('مياه');
      expect(inferCategoryName('OUT', '', 'صرف مرتبات', false, '')).toBe('مرتبات');
      expect(inferCategoryName('OUT', '', 'اشتراك نت', false, '')).toBe('إنترنت');
      expect(inferCategoryName('OUT', '', 'اشتراك أوليفيري', false, '')).toBe('اشتراك أوليفيري السنوي');
      expect(inferCategoryName('OUT', '', 'مصروف غير معروف', false, '')).toBe('مصاريف تشغيل أخرى');
    });
  });

  describe('detectHeaderRowIndex', () => {
    it('finds the first row with >= 2 non-empty cells within the scan window', () => {
      const rows = [[], [null, null, null], ['التاريخ', 'البيان', null], ['2024-01-01', 'test']];
      expect(detectHeaderRowIndex(rows)).toBe(2);
    });
    it('defaults to row 0 if nothing qualifies', () => {
      expect(detectHeaderRowIndex([[], [null]])).toBe(0);
    });
  });

  describe('rowFingerprint', () => {
    it('produces identical fingerprints for identical rows and differs on any field', () => {
      const base = { date: '2024-01-01', kind: 'IN', amount: 500, safeId: 'safe-1', description: 'x' };
      expect(rowFingerprint(base)).toBe(rowFingerprint({ ...base }));
      expect(rowFingerprint(base)).not.toBe(rowFingerprint({ ...base, amount: 501 }));
      expect(rowFingerprint(base)).not.toBe(rowFingerprint({ ...base, description: 'y' }));
    });
  });
});
