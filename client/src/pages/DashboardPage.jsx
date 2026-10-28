import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { PriorityBadge, StatusBadge } from '../components/Badges.jsx';
import { EmptyState, ErrorMessage, Loading } from '../components/Feedback.jsx';
import { ATTENTION_CARDS, STATUS_CARDS } from '../lib/dashboardCards.js';
import { customerLabel, timeAgo } from '../lib/format.js';

function StatGroup({ id, title, cards, counts, rules, attention = false }) {
  return (
    <section className="stat-group" aria-labelledby={id}>
      <h2 id={id} className="stat-group-title">
        {title}
      </h2>
      <div className="stat-grid">
        {cards.map((card) => {
          const value = counts[card.key];
          const className = [
            'stat-card',
            card.tone && `tone-${card.tone}`,
            attention && 'stat-attention',
            attention && value === 0 && 'is-zero',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <Link key={card.key} to={card.to} className={className} title={card.hint?.(rules)}>
              <span className="stat-value">{value}</span>
              <span className="stat-label">{card.label}</span>
            </Link>
          );
        })}
      </div>
    </section>
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

  const header = (
    <div className="page-header">
      <h1>Dashboard</h1>
      <button type="button" className="btn" onClick={load} disabled={loading}>
        {loading && data ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );

  if (!data) {
    return (
      <div className="page">
        {header}
        {error ? <ErrorMessage error={error} onRetry={load} /> : <Loading label="Loading dashboard…" />}
      </div>
    );
  }

  const { counts, overdueTickets, rules } = data;

  return (
    <div className="page">
      {header}
      {/* A failed refresh keeps the last counts on screen. */}
      <ErrorMessage error={error} onRetry={load} />

      {counts.total === 0 ? (
        <div className="card">
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
        </div>
      ) : (
        <>
          <StatGroup id="stat-status" title="Tickets by status" cards={STATUS_CARDS} counts={counts} rules={rules} />
          <StatGroup
            id="stat-attention"
            title="Needs attention"
            cards={ATTENTION_CARDS}
            counts={counts}
            rules={rules}
            attention
          />
        </>
      )}

      {counts.total > 0 && (
        <section className="card overdue-card">
          <div className="card-header">
            <h2>Overdue tickets</h2>
            {counts.overdue > overdueTickets.length && <Link to="/tickets?overdue=true">View all {counts.overdue} →</Link>}
          </div>
          {overdueTickets.length === 0 ? (
            <EmptyState title="Nothing overdue">Every unresolved ticket is less than {rules.overdueHours} hours old.</EmptyState>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Assignee</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {overdueTickets.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link to={`/tickets/${t.id}`}>
                        #{t.id} {t.subject}
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
                    <td className="overdue-text">{timeAgo(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <p className="muted small">
        Overdue = not resolved and created more than {rules.overdueHours} hours ago. SLA target: first public reply within{' '}
        {rules.slaFirstResponseHours} hours.
      </p>
    </div>
  );
}
