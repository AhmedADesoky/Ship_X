import { getCurrentCairoWeekStartUtc, toCairoDateString } from './cairo-time';

// Cairo is UTC+2 (EET) outside DST, UTC+3 during DST when in effect — all
// fixed instants below are picked in EET-only periods (winter) so the
// expected UTC offsets are unambiguous regardless of Egypt's current DST
// policy at test-run time.
describe('cairo-time', () => {
  describe('toCairoDateString', () => {
    it('formats a UTC instant as its Cairo-local calendar day', () => {
      // 2026-01-10T22:30:00Z = 2026-01-11T00:30 Cairo (UTC+2) — a different
      // calendar day in Cairo than in UTC, the exact misbucketing case this
      // function exists to avoid.
      expect(toCairoDateString(new Date('2026-01-10T22:30:00Z'))).toBe('2026-01-11');
      expect(toCairoDateString(new Date('2026-01-10T10:00:00Z'))).toBe('2026-01-10');
    });
  });

  describe('getCurrentCairoWeekStartUtc', () => {
    it('returns itself at 00:00 Cairo when `now` is already Saturday', () => {
      // 2026-01-10 is a Saturday. 03:00 Cairo = 01:00Z.
      const now = new Date('2026-01-10T01:00:00Z');
      const start = getCurrentCairoWeekStartUtc(now);
      expect(toCairoDateString(start)).toBe('2026-01-10');
      expect(start.toISOString()).toBe('2026-01-09T22:00:00.000Z'); // Sat 00:00 Cairo
    });

    it('returns the previous Saturday when `now` is late Friday night Cairo time', () => {
      // 2026-01-16 is a Friday. 23:00 Cairo (still Friday) = 21:00Z.
      const now = new Date('2026-01-16T21:00:00Z');
      const start = getCurrentCairoWeekStartUtc(now);
      expect(toCairoDateString(start)).toBe('2026-01-10');
    });

    it('returns the Saturday 2 days prior when `now` is a Monday', () => {
      // 2026-01-12 is a Monday.
      const now = new Date('2026-01-12T10:00:00Z');
      const start = getCurrentCairoWeekStartUtc(now);
      expect(toCairoDateString(start)).toBe('2026-01-10');
    });

    it('returns the correct Saturday when `now` is a Sunday just after midnight Cairo', () => {
      // 2026-01-11 is a Sunday. 00:30 Cairo = 2026-01-10T22:30Z.
      const now = new Date('2026-01-10T22:30:00Z');
      const start = getCurrentCairoWeekStartUtc(now);
      expect(toCairoDateString(start)).toBe('2026-01-10');
    });

    it('is always exactly midnight Cairo time (00:00:00.000 local)', () => {
      const start = getCurrentCairoWeekStartUtc(new Date('2026-01-14T12:00:00Z'));
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Cairo',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).formatToParts(start);
      const get = (type: string) => parts.find((p) => p.type === type)?.value;
      expect(`${get('hour')}:${get('minute')}:${get('second')}`).toBe('00:00:00');
    });
  });
});
