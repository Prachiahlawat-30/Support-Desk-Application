import { Link } from 'react-router-dom';

/**
 * A count with an icon and label. `tone` sets the icon tint (and, for `critical`
 * cards with a non-zero value, a subtle rose surface). Links when `to` is given.
 */
export function MetricCard({ icon: Icon, label, value, hint, tone = 'neutral', to, title, compact = false, children }) {
  const zero = value === 0;
  const className = [
    'metric',
    `tone-${tone}`,
    zero ? 'is-zero' : 'has-value',
    compact ? 'metric-compact' : '',
    to ? 'metric-link' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const body = (
    <>
      <div className="metric-top">
        {Icon && (
          <span className="metric-icon" aria-hidden="true">
            <Icon size={compact ? 15 : 16} strokeWidth={2} />
          </span>
        )}
        <span className="metric-label">{label}</span>
      </div>
      <div className="metric-value">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {hint && <div className="metric-hint">{hint}</div>}
      {children}
    </>
  );
  return to ? (
    <Link to={to} className={className} title={title}>
      {body}
    </Link>
  ) : (
    <div className={className} title={title}>
      {body}
    </div>
  );
}
