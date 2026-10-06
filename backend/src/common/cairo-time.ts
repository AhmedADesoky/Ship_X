// Dependency-free Cairo-local-time helpers for the dashboard's weekly
// window (resets every Saturday 00:00 Cairo time) — Node's built-in
// Intl.DateTimeFormat with timeZone: 'Africa/Cairo' already handles any
// DST/offset correctly on its own, so no timezone library is needed.
// Mirrors the file's one job narrowly: everything else in this backend
// stays UTC-anchored (see reports.service.ts's own comment on that), this
// is deliberately the first (and only) place that cares about a specific
// local timezone.

const CAIRO_TZ = 'Africa/Cairo';

// Returns the Cairo-local Y/M/D/H/M/S "wall clock" reading of a UTC
// instant, via Intl rather than string round-tripping through Date
// parsing (which depends on the HOST's local timezone and is therefore
// not reliably reversible) — numeric parts only.
function cairoParts(instant: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    // Intl can format the midnight hour as "24" instead of "00" with
    // hour12: false depending on locale/runtime — normalize it.
    hour: Number(get('hour')) % 24,
    weekday: get('weekday'), // "Sat", "Sun", ... "Fri"
  };
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** `YYYY-MM-DD` in Cairo local time — used to bucket a transaction into
 * its correct Cairo calendar day, not a raw-UTC day (which could
 * misbucket a transaction made shortly before/after UTC midnight that's
 * still clearly "yesterday"/"today" in Cairo). */
export function toCairoDateString(instant: Date): string {
  const { year, month, day } = cairoParts(instant);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The UTC instant corresponding to the most recent Saturday 00:00:00 in
 * Cairo local time, at or before `now`. Computed by finding how many
 * Cairo-calendar-days back the last Saturday was, walking back that many
 * whole days anchored at UTC *noon* (far enough from any day boundary
 * that the calendar-date arithmetic can't be thrown off by Cairo's
 * UTC+2/+3 offset), then snapping down to that target day's actual Cairo
 * midnight using its own measured Cairo-local hour — robust across DST
 * transitions without needing to know Cairo's offset explicitly.
 */
export function getCurrentCairoWeekStartUtc(now: Date = new Date()): Date {
  const { year, month, day, weekday } = cairoParts(now);
  const daysSinceSaturday = (WEEKDAY_INDEX[weekday] - WEEKDAY_INDEX.Sat + 7) % 7;

  const todayNoonUtcMs = Date.UTC(year, month - 1, day, 12);
  const targetNoonUtcMs = todayNoonUtcMs - daysSinceSaturday * 24 * 60 * 60 * 1000;
  const targetNoon = new Date(targetNoonUtcMs);

  // targetNoon's own Cairo-local hour (always well within 0-23, nowhere
  // near a rollover, since noon UTC +2/+3 is 14:00-15:00) tells us exactly
  // how far past that day's midnight it sits — subtracting it lands
  // exactly on Cairo 00:00 for the correct calendar day.
  const targetCairo = cairoParts(targetNoon);
  return new Date(targetNoonUtcMs - targetCairo.hour * 60 * 60 * 1000);
}
