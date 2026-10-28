// Analytics date ranges. A range is a pair of inclusive calendar dates (YYYY-MM-DD) in one
// IANA time zone: it starts at 00:00 on `from` and ends just before 00:00 on the day after
// `to`, in that zone. Presets are counted back from today in the same zone, today included.

export const PERIODS = { today: 1, '7d': 7, '30d': 30, '90d': 90 };
export const DEFAULT_PERIOD = '30d';
export const MAX_RANGE_DAYS = 731;
export const REPORTS = ['summary', 'trend', 'agents'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; // rejects 2026-02-30
}

function isValidTimeZone(value) {
  if (typeof value !== 'string' || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** Today's date (YYYY-MM-DD) in `timeZone`. */
export function todayIn(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Trend bucket size: hourly for one day, daily up to ~6 weeks, weekly up to ~6 months, then monthly. */
export function granularityFor(days) {
  if (days === 1) return 'hour';
  if (days <= 45) return 'day';
  if (days <= 180) return 'week';
  return 'month';
}

/**
 * Parses `period` or `from`/`to` (not both) plus an optional `tz` (default UTC) and, for
 * exports, `report`. Returns `{ value, errors }` like the other validators.
 */
export function parseAnalyticsQuery(query, now = new Date(), { requireReport = false } = {}) {
  const errors = {};
  const tz = query.tz === undefined || query.tz === '' ? 'UTC' : query.tz;
  if (!isValidTimeZone(tz)) errors.tz = 'Time zone must be a valid IANA name, e.g. Europe/Berlin';

  const hasCustom = query.from !== undefined || query.to !== undefined;
  let period = query.period === '' ? undefined : query.period;
  if (period !== undefined && hasCustom) errors.period = 'Use either period or from/to, not both';
  if (period === undefined && !hasCustom) period = DEFAULT_PERIOD;

  let { from, to } = query;
  if (period !== undefined && !errors.period) {
    if (!Object.hasOwn(PERIODS, period)) errors.period = `Period must be one of: ${Object.keys(PERIODS).join(', ')}`;
    else if (!errors.tz) {
      to = todayIn(tz, now);
      from = addDays(to, -(PERIODS[period] - 1));
    }
  } else if (hasCustom) {
    if (!isValidDate(from)) errors.from = 'Start date must be a valid date (YYYY-MM-DD)';
    if (!isValidDate(to)) errors.to = 'End date must be a valid date (YYYY-MM-DD)';
    if (!errors.from && !errors.to) {
      if (from > to) errors.from = 'Start date must be on or before the end date';
      else if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) errors.to = `A range can cover at most ${MAX_RANGE_DAYS} days`;
    }
  }

  let report;
  if (requireReport) {
    report = query.report ?? 'summary';
    if (!REPORTS.includes(report)) errors.report = `Report must be one of: ${REPORTS.join(', ')}`;
  }

  if (Object.keys(errors).length) return { value: null, errors };
  const days = daysBetween(from, to) + 1;
  return {
    value: { from, to, tz, period: period ?? 'custom', days, granularity: granularityFor(days), ...(requireReport && { report }) },
    errors: null,
  };
}
