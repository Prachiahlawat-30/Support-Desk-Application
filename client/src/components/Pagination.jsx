export function Pagination({ pagination, onPageChange }) {
  const { page, pageSize, total, totalPages } = pagination;
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav className="pagination" aria-label="Ticket pages">
      <span className="muted">
        Showing {first}–{last} of {total}
      </span>
      <div className="pagination-buttons">
        <button type="button" className="btn btn-small" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          ← Previous
        </button>
        <span>
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          className="btn btn-small"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next →
        </button>
      </div>
    </nav>
  );
}
