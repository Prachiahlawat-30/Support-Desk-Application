import {
  CircleCheck,
  CircleDot,
  Clock,
  Flame,
  Hourglass,
  Inbox,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  Siren,
  Timer,
  UserX,
  ArrowRight,
  PartyPopper,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { PriorityBadge, StatusBadge } from '../components/Badges.jsx';
import { EmptyState, ErrorMessage, Loading } from '../components/Feedback.jsx';
import { MetricCard } from '../components/ui/MetricCard.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { useWorkspaceChanges } from '../hooks/useRealtime.js';
import { ATTENTION_CARDS, STATUS_CARDS } from '../lib/dashboardCards.js';
import { customerLabel, formatDateTime, timeAgo } from '../lib/format.js';

// Presentation for each dashboard count. Which tickets a card counts, and where it links,
// is defined once in lib/dashboardCards.js (shared with the server tests).
const LOOK = {
  total: { icon: Inbox, tone: 'neutral' },
  open: { icon: CircleDot, tone: 'accent' },
  inProgress: { icon: LoaderCircle, tone: 'violet' },
  waitingOnCustomer: { icon: Hourglass, tone: 'warning' },
  resolved: { icon: CircleCheck, tone: 'success' },
  urgent: { icon: Flame, tone: 'critical' },
  overdue: { icon: Clock, tone: 'critical' },
  unassigned: { icon: UserX, tone: 'warning' },
  slaBreached: { icon: Timer, tone: 'critical' },
  slaDue: { icon: Hourglass, tone: 'warning' },
  escalated: { icon: ShieldAlert, tone: 'critical' },
  escalatedLevel2: { icon: Siren, tone: 'critical' },
};

const GROUPS = [
  { id: 'queue', title: 'Queue', description: 'Unresolved tickets that need an owner or are running late' },
  { id: 'sla', title: 'First-response SLA', description: 'Tickets still waiting for their first public reply' },
  { id: 'escalation', title: 'Escalation', description: 'Breached tickets recorded by the escalation check' },
];

/** Share of each status in the total, as a thin stacked bar (real counts only). */
function StatusBar({ counts }) {
  const parts = STATUS_CARDS.filter((c) => c.key !== 'total' && counts[c.key] > 0);
  if (!counts.total) return null;
  return (
    <div className="status-bar" role="img" aria-label={parts.map((p) => `${counts[p.key]} ${p.label.toLowerCase()}`).join(', ')}>
      {parts.map((p) => (
        <span key={p.key} className={`status-bar-seg tone-${LOOK[p.key].tone}`} style={{ flexGrow: counts[p.key] }} />
      ))}
    </div>
  );
}

export function DashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .dashboard()
      .then((res) => setData(res.data))
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);
  // Counts come from the API; bursts of ticket changes trigger one reload.
  useWorkspaceChanges(load, { delayMs: 1000 });

  const header = (
    <PageHeader
      eyebrow="Support workspace"
      title="Overview"
      description="Live ticket counts. Select any figure to open the matching tickets."
      actions={
        <button type="button" className="btn" onClick={load} disabled={loading}>
          <RefreshCw size={15} className={loading && data ? 'spin' : ''} aria-hidden="true" />
          {loading && data ? 'Refreshing…' : 'Refresh'}
        </button>
      }
    />
  );

  if (!data) {
    return (
      <div className="page">
        {header}
        {error ? <ErrorMessage error={error} onRetry={load} /> : <Loading label="Loading overview…" />}
      </div>
    );
  }

  const { counts, overdueTickets, rules } = data;
  const [totalCard, ...statusCards] = STATUS_CARDS;

  return (
    <div className="page">
      {header}
      {/* A failed refresh keeps the last counts on screen. */}
      <ErrorMessage error={error} onRetry={load} />

      {counts.total === 0 ? (
        <section className="panel">
          <EmptyState
            title="No tickets yet"
            action={
              <Link to="/tickets/new" className="btn btn-primary">
                Create the first ticket
              </Link>
            }
          >
            Ticket counts and overdue tickets will show up here once the first ticket is created.
          </EmptyState>
        </section>
      ) : (
        <>
          <section aria-labelledby="status-title">
            <h2 id="status-title" className="section-title">
              Tickets by status
            </h2>
            <div className="metric-grid status-grid">
              <MetricCard
                icon={LOOK.total.icon}
                tone="neutral"
                label={totalCard.label}
                value={counts.total}
                to={totalCard.to}
              >
                <StatusBar counts={counts} />
              </MetricCard>
              {statusCards.map((card) => (
                <MetricCard
                  key={card.key}
                  icon={LOOK[card.key].icon}
                  tone={LOOK[card.key].tone}
                  label={card.label}
                  value={counts[card.key]}
                  hint={counts.total ? `${Math.round((counts[card.key] / counts.total) * 100)}% of all tickets` : null}
                  to={card.to}
                />
              ))}
            </div>
          </section>

          <section className="panel attention-panel" aria-labelledby="attention-title">
            <div className="panel-head">
              <div>
                <h2 id="attention-title">Needs attention</h2>
                <p className="panel-desc">Unresolved work only. Zero means nothing to act on.</p>
              </div>
            </div>
            <div className="attention-groups">
              {GROUPS.map((group) => {
                const cards = ATTENTION_CARDS.filter((c) => c.group === group.id);
                return (
                  <div key={group.id} className={`attention-group group-${group.id}`} style={{ '--cols': cards.length }}>
                    <div className="attention-group-head">
                      <h3>{group.title}</h3>
                      <p>{group.description}</p>
                    </div>
                    <div className="attention-tiles">
                      {cards.map((card) => (
                        <MetricCard
                          key={card.key}
                          compact
                          icon={LOOK[card.key].icon}
                          tone={LOOK[card.key].tone}
                          label={card.label}
                          value={counts[card.key]}
                          title={card.hint?.(rules)}
                          to={card.to}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel" aria-labelledby="overdue-title">
            <div className="panel-head">
              <div>
                <h2 id="overdue-title">Overdue tickets</h2>
                <p className="panel-desc">Not resolved and created more than {rules.overdueHours} hours ago, oldest first.</p>
              </div>
              {counts.overdue > 0 && (
                <Link to="/tickets?overdue=true" className="btn btn-ghost">
                  View all {counts.overdue} <ArrowRight size={15} aria-hidden="true" />
                </Link>
              )}
            </div>
            {overdueTickets.length === 0 ? (
              <EmptyState icon={PartyPopper} title="Nothing overdue">
                Every unresolved ticket is less than {rules.overdueHours} hours old.
              </EmptyState>
            ) : (
              <div className="table-surface">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Ticket</th>
                      <th scope="col">Customer</th>
                      <th scope="col">Status</th>
                      <th scope="col">Priority</th>
                      <th scope="col">Assignee</th>
                      <th scope="col" className="num">
                        Created
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {overdueTickets.map((t) => (
                      <tr key={t.id}>
                        <td className="cell-subject">
                          <Link to={`/tickets/${t.id}`} className="ticket-link">
                            <span className="ticket-id">#{t.id}</span>
                            <span className="ticket-subject">{t.subject}</span>
                          </Link>
                        </td>
                        <td>{customerLabel(t)}</td>
                        <td>
                          <StatusBadge status={t.status} />
                        </td>
                        <td>
                          <PriorityBadge priority={t.priority} />
                        </td>
                        <td>{t.assigneeName ?? <span className="muted">Unassigned</span>}</td>
                        <td className="num overdue-text" title={formatDateTime(t.createdAt)}>
                          {timeAgo(t.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <p className="footnote">
        SLA target: first public reply within {rules.slaFirstResponseHours} hours. Escalation moves to senior attention{' '}
        {rules.escalationLevel2Hours} hours after a missed deadline.
      </p>
    </div>
  );
}
