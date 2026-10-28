import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { BarList, ColumnChart } from '../components/analytics/Charts.jsx';
import { ErrorMessage, Loading } from '../components/Feedback.jsx';
import { ticketsLink, UNRESOLVED } from '../lib/dashboardCards.js';
import { formatMinutes } from '../lib/sla.js';

// Support analytics (admins only; the API enforces it). The selected range lives in the URL
// (?period=7d or ?from=…&to=…) so it survives reloads and can be shared.

const PRESETS = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const REPORTS = [
  { value: 'summary', label: 'Summary' },
  { value: 'trend', label: 'Volume trend' },
  { value: 'agents', label: 'Agents' },
];

// Dates from the API are calendar dates (YYYY-MM-DD) or local bucket starts; format them in
// UTC so the browser's own zone never shifts them.
const asDate = (text) => new Date(`${text.slice(0, 10)}T${text.length > 10 ? text.slice(11, 16) : '00:00'}:00Z`);
const fmt = (options) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...options });
const dayShort = fmt({ month: 'short', day: 'numeric' });
const dayLong = fmt({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const dayMedium = fmt({ dateStyle: 'medium' });
const monthLabel = fmt({ month: 'short', year: 'numeric' });
const hourLabel = fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const addDays = (date, n) => new Date(date.getTime() + n * 86_400_000);

function bucketLabels(bucket, range) {
  const start = asDate(bucket);
  const from = asDate(range.from);
  const to = asDate(range.to);
  switch (range.granularity) {
    case 'hour':
      return { label: hourLabel.format(start), title: `${dayMedium.format(start)}, ${hourLabel.format(start)}` };
    case 'week': {
      const first = start < from ? from : start;
      const last = addDays(start, 6) > to ? to : addDays(start, 6);
      return { label: dayShort.format(first), title: `${dayShort.format(first)} – ${dayMedium.format(last)}` };
    }
    case 'month': {
      const first = start < from ? from : start;
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
      const last = end > to ? to : end;
      return { label: monthLabel.format(start), title: `${dayShort.format(first)} – ${dayMedium.format(last)}` };
    }
    default:
      return { label: dayShort.format(start), title: dayLong.format(start) };
  }
}

function duration(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return '<1m';
  return formatMinutes(Math.round(seconds / 60));
}

const count = (n) => (n === null || n === undefined ? '—' : n.toLocaleString());
const pct = (n) => (n === null || n === undefined ? '—' : `${n}%`);

function Tile({ label, value, detail }) {
  return (
    <div className="stat-card">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {detail && <span className="stat-hint">{detail}</span>}
    </div>
  );
}

function RangePicker({ params, setParams, range }) {
  const custom = !params.get('period') && params.get('from');
  const [showCustom, setShowCustom] = useState(Boolean(custom));
  const [from, setFrom] = useState(params.get('from') ?? range?.from ?? '');
  const [to, setTo] = useState(params.get('to') ?? range?.to ?? '');
  const [error, setError] = useState(null);
  const period = params.get('period') ?? (custom ? null : '30d');

  function applyCustom(event) {
    event.preventDefault();
    if (!from || !to) return setError('Choose a start and an end date.');
    if (from > to) return setError('The start date must be on or before the end date.');
    setError(null);
    setParams({ from, to }, { replace: true });
  }

  return (
    <div className="range-picker">
      <div className="segmented" role="group" aria-label="Date range">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            className={period === p.value && !showCustom ? 'active' : ''}
            aria-pressed={period === p.value && !showCustom}
            onClick={() => {
              setShowCustom(false);
              setParams({ period: p.value }, { replace: true });
            }}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          className={showCustom ? 'active' : ''}
          aria-pressed={showCustom}
          onClick={() => {
            setShowCustom(true);
            if (range) {
              setFrom(range.from);
              setTo(range.to);
            }
          }}
        >
          Custom
        </button>
      </div>
      {showCustom && (
        <form className="custom-range" onSubmit={applyCustom} noValidate>
          <label>
            From <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-small">
            Apply
          </button>
          {error && <span className="field-error">{error}</span>}
        </form>
      )}
    </div>
  );
}

function ExportControl({ query }) {
  const [report, setReport] = useState('summary');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      await api.exportAnalytics({ ...query, report });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="export-control">
      <select aria-label="Report to export" value={report} onChange={(e) => setReport(e.target.value)}>
        {REPORTS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <button type="button" className="btn" onClick={run} disabled={busy}>
        {busy ? 'Exporting…' : 'Export CSV'}
      </button>
      <ErrorMessage error={error} />
    </div>
  );
}

export function AnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  const query = params.get('period')
    ? { period: params.get('period'), tz: TIME_ZONE }
    : params.get('from')
      ? { from: params.get('from'), to: params.get('to'), tz: TIME_ZONE }
      : { period: '30d', tz: TIME_ZONE };
  const queryKey = JSON.stringify(query);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const requestId = ++latest.current; // a newer request makes older responses stale
    const q = JSON.parse(queryKey);
    setLoading(true);
    setError(null);
    Promise.all([api.analyticsOverview(q), api.analyticsAgents(q)])
      .then(([overview, agents]) => {
        if (requestId === latest.current) setData({ overview: overview.data, agents: agents.data.agents });
      })
      .catch((err) => requestId === latest.current && setError(err))
      .finally(() => requestId === latest.current && setLoading(false));
  }, [queryKey, reloadKey]);

  const o = data?.overview;
  const range = o?.range;
  const yMax = o ? Math.max(...o.trend.map((b) => Math.max(b.created, b.resolved)), 0) : 0;
  const points = (field) =>
    o.trend.map((b) => ({ key: b.bucket, value: b[field], ...bucketLabels(b.bucket, range) }));
  const rangeText =
    range &&
    (range.from === range.to
      ? dayMedium.format(asDate(range.from))
      : `${dayMedium.format(asDate(range.from))} – ${dayMedium.format(asDate(range.to))}`);

  return (
    <div className="page analytics">
      <div className="page-header">
        <h1>Analytics</h1>
        {o && <ExportControl query={query} />}
      </div>

      <RangePicker key={queryKey} params={params} setParams={setParams} range={range} />

      {error && error.status === 403 ? (
        <div className="alert alert-error" role="alert">
          Analytics is available to administrators only.
        </div>
      ) : (
        <ErrorMessage error={error} onRetry={() => setReloadKey((k) => k + 1)} />
      )}
      {!data && loading && <Loading label="Loading analytics…" />}

      {o && (
        <div className={`analytics-body${loading ? ' is-refreshing' : ''}`} aria-busy={loading}>
          <p className="range-summary">
            <strong>{rangeText}</strong> <span className="muted">({range.tz}, both dates included)</span>
          </p>

          <section aria-labelledby="period-title">
            <h2 id="period-title" className="stat-group-title">
              In this period
            </h2>
            <div className="stat-grid">
              <Tile label="Tickets created" value={count(o.period.created)} />
              <Tile label="Tickets resolved" value={count(o.resolution.resolved)} />
              <Tile
                label="First-response SLA met"
                value={pct(o.sla.compliancePercent)}
                detail={
                  o.sla.compliancePercent === null
                    ? 'No ticket has an SLA outcome yet'
                    : `${o.sla.met} met · ${o.sla.breached} breached`
                }
              />
              <Tile label="Avg first response" value={duration(o.sla.averageFirstResponseSeconds)} detail={`${o.sla.responded} replied tickets`} />
              <Tile
                label="Avg resolution time"
                value={duration(o.resolution.averageSeconds)}
                detail={`Median ${duration(o.resolution.medianSeconds)}`}
              />
            </div>
          </section>

          <section className="card analytics-charts" aria-label="Ticket volume">
            <ColumnChart
              title={`Tickets created per ${range.granularity}`}
              points={points('created')}
              color="var(--primary)"
              yMax={yMax}
              valueLabel="created"
              summary={`${o.period.created} tickets created, ${rangeText}`}
              emptyText="No tickets were created in this period."
            />
            <ColumnChart
              title={`Tickets resolved per ${range.granularity}`}
              points={points('resolved')}
              color="var(--resolved-fg)"
              yMax={yMax}
              valueLabel="resolved"
              summary={`${o.resolution.resolved} tickets resolved, ${rangeText}`}
              emptyText="No tickets were resolved in this period."
            />
          </section>

          <div className="analytics-grid">
            <section className="card" aria-labelledby="sla-perf-title">
              <h2 id="sla-perf-title">First-response SLA</h2>
              <p className="muted small">Tickets created in this period. Target: first public reply within {o.sla.targetHours}h.</p>
              <dl className="metric-list">
                <dt>Met</dt>
                <dd>{o.sla.met}</dd>
                <dt>Breached</dt>
                <dd>
                  {o.sla.breached}{' '}
                  <span className="muted small">
                    ({o.sla.breachedLateReply} replied late, {o.sla.breachedNoReply} still no reply)
                  </span>
                </dd>
                <dt>Compliance</dt>
                <dd>{pct(o.sla.compliancePercent)}</dd>
                <dt>Not counted yet</dt>
                <dd>
                  {o.sla.pending} <span className="muted small">no reply, deadline not reached</span>
                </dd>
                <dt>Not applicable</dt>
                <dd>
                  {o.sla.notApplicable} <span className="muted small">resolved without a public reply</span>
                </dd>
                <dt>Avg first response</dt>
                <dd>{duration(o.sla.averageFirstResponseSeconds)}</dd>
              </dl>
              <p className="muted small formula">
                Compliance = met ÷ (met + breached) × 100. Internal notes never count as a reply.
              </p>
            </section>

            <section className="card" aria-labelledby="dist-title">
              <h2 id="dist-title">Tickets created in this period</h2>
              <p className="muted small">By their current status and priority. Categories aren't stored, so there is no category breakdown.</p>
              <BarList title="Status" items={o.distribution.status} total={o.period.created} caption="Tickets by status" />
              <BarList title="Priority" items={o.distribution.priority} total={o.period.created} caption="Tickets by priority" />
            </section>

            <section className="card" aria-labelledby="now-title">
              <h2 id="now-title">Right now</h2>
              <p className="muted small">All tickets as they are now, whatever the selected period.</p>
              <dl className="metric-list">
                <dt>
                  <Link to={ticketsLink({ status: 'Open' })}>Open</Link>
                </dt>
                <dd>{o.current.open}</dd>
                <dt>
                  <Link to={ticketsLink({ status: 'In Progress' })}>In progress</Link>
                </dt>
                <dd>{o.current.inProgress}</dd>
                <dt>
                  <Link to={ticketsLink({ status: 'Waiting on Customer' })}>Waiting on customer</Link>
                </dt>
                <dd>{o.current.waitingOnCustomer}</dd>
                <dt>
                  <Link to={ticketsLink({ assignee: 'unassigned', status: UNRESOLVED })}>Unassigned</Link>
                </dt>
                <dd>{o.current.unassigned}</dd>
                <dt>
                  <Link to={ticketsLink({ slaBreached: 'true', status: UNRESOLVED })}>SLA breached</Link>
                </dt>
                <dd>{o.current.slaBreached}</dd>
                <dt>
                  <Link to={ticketsLink({ slaDue: 'true' })}>Reply due within the hour</Link>
                </dt>
                <dd>{o.current.slaDue}</dd>
                <dt>Awaiting first reply</dt>
                <dd>{o.current.awaitingFirstReply}</dd>
              </dl>
            </section>
          </div>

          <section className="card" aria-labelledby="agents-title">
            <h2 id="agents-title">Agents</h2>
            <p className="muted small">
              First replies count tickets created in this period, credited to whoever sent the first public reply. Resolved
              counts tickets resolved in this period that are <em>currently</em> assigned to the agent (earlier assignees
              aren't recorded reliably). Open assigned is right now.
            </p>
            <div className="table-scroll">
              <table className="table agents-table">
                <thead>
                  <tr>
                    <th scope="col">Agent</th>
                    <th scope="col" className="num">Open assigned now</th>
                    <th scope="col" className="num">Resolved (current assignee)</th>
                    <th scope="col" className="num">Avg resolution</th>
                    <th scope="col" className="num">First replies</th>
                    <th scope="col" className="num">On time</th>
                    <th scope="col" className="num">SLA met</th>
                    <th scope="col" className="num">Avg first response</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agents.map((a) => (
                    <tr key={a.id}>
                      <th scope="row">
                        {a.name} <span className="muted small">{a.role}</span>
                      </th>
                      <td className="num">{a.openAssignedNow}</td>
                      <td className="num">{a.resolvedInPeriod}</td>
                      <td className="num">{duration(a.averageResolutionSeconds)}</td>
                      <td className="num">{a.firstReplies}</td>
                      <td className="num">{a.firstRepliesOnTime}</td>
                      <td className="num">{pct(a.compliancePercent)}</td>
                      <td className="num">{duration(a.averageFirstResponseSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
