import { Inbox } from 'lucide-react';

export function Spinner({ small = false }) {
  return <span className={`spinner${small ? ' spinner-small' : ''}`} role="status" aria-label="Loading" />;
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="loading">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function ErrorMessage({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <span>{error.message || String(error)}</span>
      {onRetry && (
        <button type="button" className="btn btn-small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, action, icon: Icon = Inbox }) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">
        <Icon size={20} strokeWidth={1.8} />
      </span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
