import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { PriorityBadge, SlaBadge, StatusBadge, TicketFlags } from '../components/Badges.jsx';
import { EmptyState, ErrorMessage, Loading, Spinner } from '../components/Feedback.jsx';
import { Pagination } from '../components/Pagination.jsx';
import { useAgents } from '../hooks/useAgents.js';
import { PRIORITIES, SORT_OPTIONS, STATUSES } from '../lib/constants.js';
import { customerLabel, formatDateTime, timeAgo } from '../lib/format.js';

// Filters live in the URL so they survive refreshes and can be shared or bookmarked.
const FILTER_KEYS = ['search', 'status', 'priority', 'assignee', 'overdue', 'slaBreached', 'slaDue', 'escalation'];
const PAGE_SIZE = 15;

export function TicketListPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { agents } = useAgents();
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchInput, setSearchInput] = useState(params.get('search') ?? '');

  const queryString = params.toString();
  const hasFilters = FILTER_KEYS.some((k) => params.get(k));

  const updateParams = useCallback(
    (changes) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(changes)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          if (!('page' in changes)) next.delete('page'); // new filters start from page 1
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // Keep the search box in sync when the URL changes from elsewhere (nav link, back button).
  const urlSearch = params.get('search') ?? '';
  useEffect(() => setSearchInput(urlSearch), [urlSearch]);

  // Debounce typing in the search box.
  useEffect(() => {
    if (searchInput.trim() === urlSearch) return undefined;
    const timer = setTimeout(() => updateParams({ search: searchInput.trim() }), 300);
    return () => clearTimeout(timer);
  }, [searchInput, urlSearch, updateParams]);

  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let ignore = false; // drop responses that arrive after the filters changed again
    setLoading(true);
    setError(null);
    const query = Object.fromEntries(new URLSearchParams(queryString));
    api
      .listTickets({ pageSize: PAGE_SIZE, ...query })
      .then((res) => !ignore && setResult(res))
      .catch((err) => !ignore && setError(err))
      .finally(() => !ignore && setLoading(false));
    return () => {
      ignore = true;
    };
  }, [queryString, reloadKey]);

  function clearFilters() {
    setSearchInput('');
    setParams({}, { replace: true });
  }

  const select = (key) => ({
    value: params.get(key) ?? '',
    onChange: (e) => updateParams({ [key]: e.target.value }),
  });

  return (
    <div className="page">
      <div className="page-header">
        <h1>Tickets</h1>
        {loading && result && <Spinner small />}
      </div>

      <div className="card filters" role="search">
        <input
          type="search"
          className="filter-search"
          placeholder="Search tickets…"
          aria-label="Search tickets"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <select aria-label="Filter by status" {...select('status')}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
          {params.get('status')?.includes(',') && <option value={params.get('status')}>Unresolved</option>}
        </select>
        <select aria-label="Filter by priority" {...select('priority')}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select aria-label="Filter by assignee" {...select('assignee')}>
          <option value="">All assignees</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
          {agents.map((a) => (
            <option key={a.id} value={String(a.id)}>
              {a.name}
            </option>
          ))}
        </select>
        <select aria-label="Filter by escalation" {...select('escalation')}>
          <option value="">Any escalation</option>
          <option value="active">Escalated</option>
          <option value="level2">Senior attention</option>
        </select>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={params.get('overdue') === 'true'}
            onChange={(e) => updateParams({ overdue: e.target.checked ? 'true' : '' })}
          />
          Overdue only
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={params.get('slaBreached') === 'true'}
            onChange={(e) => updateParams({ slaBreached: e.target.checked ? 'true' : '' })}
          />
          SLA breached only
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={params.get('slaDue') === 'true'}
            onChange={(e) => updateParams({ slaDue: e.target.checked ? 'true' : '' })}
          />
          Reply due soon
        </label>
        <select aria-label="Sort tickets" {...select('sort')}>
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value === 'updated' ? '' : o.value}>
              Sort: {o.label}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button type="button" className="btn btn-link" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      <ErrorMessage error={error} onRetry={() => setReloadKey((k) => k + 1)} />

      {!result && loading && <Loading label="Loading tickets…" />}

      {result && result.data.length === 0 && !loading && (
        <div className="card">
          {hasFilters ? (
            <EmptyState
              title="No tickets match these filters"
              action={
                <button type="button" className="btn" onClick={clearFilters}>
                  Clear filters
                </button>
              }
            >
              Try a different search term or remove some filters.
            </EmptyState>
          ) : (
            <EmptyState
              title="No tickets yet"
              action={
                <Link to="/tickets/new" className="btn btn-primary">
                  Create the first ticket
                </Link>
              }
            >
              New customer issues will show up here.
            </EmptyState>
          )}
        </div>
      )}

      {result && result.data.length > 0 && (
        <div className={`card table-card${loading ? ' is-refreshing' : ''}`}>
          <table className="table table-clickable">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Priority</th>
                <th>First response</th>
                <th>Assignee</th>
                <th>Last updated</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((t) => (
                <tr key={t.id} onClick={() => navigate(`/tickets/${t.id}`)} className={t.isOverdue ? 'row-overdue' : ''}>
                  <td>
                    <Link to={`/tickets/${t.id}`} onClick={(e) => e.stopPropagation()} className="ticket-link">
                      <span className="muted">#{t.id}</span> {t.subject}
                    </Link>
                    <div className="flags">
                      <TicketFlags ticket={t} showSla={false} />
                    </div>
                  </td>
                  <td>
                    <div>{customerLabel(t)}</div>
                    {t.customerName && t.customerEmail && <div className="muted small">{t.customerEmail}</div>}
                  </td>
                  <td>
                    <StatusBadge status={t.status} />
                  </td>
                  <td>
                    <PriorityBadge priority={t.priority} />
                  </td>
                  <td>
                    <SlaBadge sla={t.sla} />
                  </td>
                  <td>{t.assigneeName ?? <span className="muted">Unassigned</span>}</td>
                  <td title={formatDateTime(t.updatedAt)}>{timeAgo(t.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination pagination={result.pagination} onPageChange={(page) => updateParams({ page: String(page) })} />
        </div>
      )}
    </div>
  );
}
