import { useEffect, useRef } from 'react';

/**
 * Modal confirmation built on <dialog>, which gives focus trapping, Escape to cancel and
 * an inert background. Renders nothing while closed.
 */
export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', danger = false, busy = false, onConfirm, onCancel }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(e) => e.target === ref.current && !busy && onCancel()}
    >
      <div className="dialog-body">
        <h2 id="confirm-title">{title}</h2>
        <div className="dialog-text">{children}</div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </button>
          <button type="button" className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
