import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { PriorityBadge, SlaBadge, StatusBadge, TicketFlags } from '../components/Badges.jsx';
import { EmptyState, ErrorMessage, Loading, Spinner } from '../components/Feedback.jsx';
import { Pagination } from '../components/Pagination.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { useWorkspaceChanges } from '../hooks/useRealtime.js';
import { ListFilter, Search, SearchX, X } from 'lucide-react';
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
  // Another user changed a ticket: reload this page of results with the same filters and
  // sort, so rows update, appear or drop out exactly as the API decides.
  useWorkspaceChanges(() => setReloadKey((k) => k + 1), { delayMs: 500 });
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
      <PageHeader
        eyebrow="Workspace"
        title="Tickets"
        description={
          result
            ? `${result.pagination.total.toLocaleString()} ${result.pagination.total === 1 ? 'ticket' : 'tickets'}${hasFilters ? ' match the current filters' : ''}`
            : 'Search, filter and sort every ticket.'
        }
        actions={loading && result ? <Spinner small /> : null}
      />

      <div className="panel toolbar" role="search">
        <div className="toolbar-row">
          <label className="search-field">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search subject, customer or email…"
              aria-label="Search tickets"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </label>
          <select aria-label="Sort tickets" className="toolbar-sort" {...select('sort')}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value === 'updated' ? '' : o.value}>
                Sort: {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="toolbar-row toolbar-filters">
          <span className="toolbar-label">
            <ListFilter size={14} aria-hidden="true" /> Filters
          </span>
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
        <label className="chip-toggle">
          <input
            type="checkbox"
            checked={params.get('overdue') === 'true'}
            onChange={(e) => updateParams({ overdue: e.target.checked ? 'true' : '' })}
          />
          Overdue
        </label>
        <label className="chip-toggle">
          <input
            type="checkbox"
            checked={params.get('slaBreached') === 'true'}
            onChange={(e) => updateParams({ slaBreached: e.target.checked ? 'true' : '' })}
          />
          SLA breached
        </label>
        <label className="chip-toggle">
          <input
            type="checkbox"
            checked={params.get('slaDue') === 'true'}
            onChange={(e) => updateParams({ slaDue: e.target.checked ? 'true' : '' })}
          />
          Reply due soon
        </label>
        {hasFilters && (
          <button type="button" className="btn btn-ghost btn-small" onClick={clearFilters}>
            <X size={14} aria-hidden="true" /> Clear filters
          </button>
        )}
        </div>
      </div>

      <ErrorMessage error={error} onRetry={() => setReloadKey((k) => k + 1)} />

      {!result && loading && <Loading label="Loading tickets…" />}

      {result && result.data.length === 0 && !loading && (
        <div className="panel">
          {hasFilters ? (
            <EmptyState
              icon={SearchX}
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
        <div className={`panel panel-flush${loading ? ' is-refreshing' : ''}`}>
          <div className="table-surface table-surface-flush">
          <table className="table table-clickable tickets-table">
            <thead>
              <tr>
                <th scope="col">Ticket</th>
                <th scope="col">Customer</th>
                <th scope="col">Status</th>
                <th scope="col">Priority</th>
                <th scope="col">First response</th>
                <th scope="col">Assignee</th>
                <th scope="col" className="num">Updated</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((t) => (
                <tr key={t.id} onClick={() => navigate(`/tickets/${t.id}`)} className={t.isOverdue ? 'row-overdue' : ''}>
                  <td className="cell-subject">
                    <Link to={`/tickets/${t.id}`} onClick={(e) => e.stopPropagation()} className="ticket-link" title={t.subject}>
                      <span className="ticket-id">#{t.id}</span>
                      <span className="ticket-subject">{t.subject}</span>
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
                  <td className="num muted" title={formatDateTime(t.updatedAt)}>{timeAgo(t.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <Pagination pagination={result.pagination} onPageChange={(page) => updateParams({ page: String(page) })} />
        </div>
      )}
    </div>
  );
}
