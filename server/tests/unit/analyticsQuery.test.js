import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { csvCell, toCsv } from '../../src/utils/csv.js';
import { granularityFor, parseAnalyticsQuery, todayIn } from '../../src/validation/analyticsQuery.js';

// Fixed "now": 2026-03-10 20:00 UTC, which is already 2026-03-11 in Asia/Kolkata (UTC+05:30).
const NOW = new Date('2026-03-10T20:00:00Z');
const parse = (q, opts) => parseAnalyticsQuery(q, NOW, opts);

describe('parseAnalyticsQuery', () => {
  it('defaults to the last 30 days in UTC', () => {
    assert.deepEqual(parse({}).value, {
      from: '2026-02-09',
      to: '2026-03-10',
      tz: 'UTC',
      period: '30d',
      days: 30,
      granularity: 'day',
    });
  });

  it('counts presets back from today in the requested time zone, today included', () => {
    assert.deepEqual(
      [parse({ period: 'today' }).value.from, parse({ period: 'today' }).value.to, parse({ period: 'today' }).value.granularity],
      ['2026-03-10', '2026-03-10', 'hour'],
    );
    const kolkata = parse({ period: '7d', tz: 'Asia/Kolkata' }).value;
    assert.deepEqual([kolkata.from, kolkata.to, kolkata.days], ['2026-03-05', '2026-03-11', 7]);
    assert.equal(parse({ period: '90d' }).value.granularity, 'week');
    assert.equal(todayIn('America/Los_Angeles', NOW), '2026-03-10');
  });

  it('accepts a custom inclusive range, including a single day', () => {
    assert.deepEqual(parse({ from: '2026-03-01', to: '2026-03-01' }).value.days, 1);
    assert.deepEqual(parse({ from: '2024-02-28', to: '2024-03-01' }).value.days, 3, 'leap day');
  });

  it('rejects invalid input', () => {
    const errors = (q, opts) => Object.keys(parse(q, opts).errors ?? {});
    assert.deepEqual(errors({ from: '2026-02-30', to: '2026-03-01' }), ['from']);
    assert.deepEqual(errors({ from: '03/01/2026', to: '2026-03-01' }), ['from']);
    assert.deepEqual(errors({ from: '2026-03-01' }), ['to']);
    assert.deepEqual(errors({ from: '2026-03-02', to: '2026-03-01' }), ['from']);
    assert.deepEqual(errors({ from: '2020-01-01', to: '2026-01-01' }), ['to']);
    assert.deepEqual(errors({ period: 'year' }), ['period']);
    assert.deepEqual(errors({ period: '7d', from: '2026-03-01', to: '2026-03-02' }), ['period']);
    assert.deepEqual(errors({ tz: 'Not/AZone' }), ['tz']);
    assert.deepEqual(errors({ from: ['2026-03-01'], to: '2026-03-02' }), ['from']);
    assert.deepEqual(errors({ report: 'everything' }, { requireReport: true }), ['report']);
  });

  it('picks the export report, defaulting to the summary', () => {
    assert.equal(parse({}, { requireReport: true }).value.report, 'summary');
    assert.equal(parse({ report: 'agents' }, { requireReport: true }).value.report, 'agents');
  });

  it('chooses bucket sizes by range length', () => {
    assert.deepEqual([1, 2, 45, 46, 180, 181].map(granularityFor), ['hour', 'day', 'day', 'week', 'week', 'month']);
  });
});

describe('CSV', () => {
  it('quotes separators, quotes and line breaks', () => {
    assert.equal(csvCell('plain'), 'plain');
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell('two\nlines'), '"two\nlines"');
    assert.equal(csvCell(null), '');
    assert.equal(csvCell(undefined), '');
  });

  it('keeps numbers as numbers', () => {
    assert.equal(csvCell(42), '42');
    assert.equal(csvCell(-3.5), '-3.5');
    assert.equal(csvCell(Number.NaN), '');
  });

  it('neutralises text that a spreadsheet would run as a formula', () => {
    for (const value of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\rx']) {
      assert.ok(csvCell(value).replace(/^"/, '').startsWith("'"), value);
    }
    assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  });

  it('joins rows with CRLF', () => {
    assert.equal(toCsv([['a', 1], ['b', null]]), 'a,1\r\nb,\r\n');
  });
});
