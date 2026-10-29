/** Page title block: optional eyebrow and description, with actions on the right. */
export function PageHeader({ eyebrow, title, description, actions, children }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p className="page-desc">{description}</p>}
        {children}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </header>
  );
}
