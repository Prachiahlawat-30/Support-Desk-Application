import {
  ChartColumn,
  ChevronDown,
  Hourglass,
  LayoutDashboard,
  LogOut,
  Menu,
  MessagesSquare,
  Plus,
  Search,
  Siren,
  Ticket,
  Timer,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useRealtimeStatus } from '../../hooks/useRealtime.js';
import { realtime } from '../../lib/socket.js';
import { ticketsLink, UNRESOLVED } from '../../lib/dashboardCards.js';

// The application frame: a sidebar (a drawer below 1024px), a compact top bar and the
// routed page. Every navigation entry opens an existing page or ticket-list filter.

// Query keys that define the saved ticket views in the Support group.
const VIEW_KEYS = ['slaBreached', 'slaDue', 'escalation'];

const NAV = [
  {
    label: 'Workspace',
    items: [
      { label: 'Overview', to: '/', icon: LayoutDashboard, isActive: (l) => l.pathname === '/' },
      {
        label: 'Tickets',
        to: '/tickets',
        icon: Ticket,
        isActive: (l) => l.pathname.startsWith('/tickets') && !VIEW_KEYS.some((k) => new URLSearchParams(l.search).has(k)),
      },
      { label: 'Analytics', to: '/analytics', icon: ChartColumn, adminOnly: true, isActive: (l) => l.pathname === '/analytics' },
    ],
  },
  {
    label: 'Support',
    items: [
      {
        label: 'SLA breached',
        to: ticketsLink({ slaBreached: 'true', status: UNRESOLVED }),
        icon: Timer,
        isActive: (l) => l.pathname === '/tickets' && new URLSearchParams(l.search).has('slaBreached'),
      },
      {
        label: 'Reply due soon',
        to: ticketsLink({ slaDue: 'true' }),
        icon: Hourglass,
        isActive: (l) => l.pathname === '/tickets' && new URLSearchParams(l.search).has('slaDue'),
      },
      {
        label: 'Escalations',
        to: ticketsLink({ escalation: 'active' }),
        icon: Siren,
        isActive: (l) => l.pathname === '/tickets' && new URLSearchParams(l.search).has('escalation'),
      },
    ],
  },
];

function pageContext(location) {
  const { pathname } = location;
  if (pathname === '/') return ['Workspace', 'Overview'];
  if (pathname === '/tickets/new') return ['Tickets', 'New ticket'];
  const ticket = /^\/tickets\/(\d+)$/.exec(pathname);
  if (ticket) return ['Tickets', `Ticket #${ticket[1]}`];
  if (pathname.startsWith('/tickets')) return ['Workspace', 'Tickets'];
  if (pathname === '/analytics') return ['Workspace', 'Analytics'];
  return ['Workspace', 'Not found'];
}

const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

export function BrandMark({ size = 30 }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <MessagesSquare size={Math.round(size * 0.55)} strokeWidth={2} />
    </span>
  );
}

function Sidebar({ user, open, onClose, onSignOut }) {
  const location = useLocation();
  const firstLink = useRef(null);

  useEffect(() => {
    if (open) firstLink.current?.focus();
  }, [open]);

  return (
    <aside id="app-sidebar" className={`sidebar${open ? ' is-open' : ''}`} aria-label="Main navigation">
      <div className="sidebar-brand">
        <Link to="/" className="brand" onClick={onClose}>
          <BrandMark />
          <span className="brand-text">
            <span className="brand-name">Comhord</span>
            <span className="brand-sub">Support desk</span>
          </span>
        </Link>
        <button type="button" className="icon-btn sidebar-close" onClick={onClose} aria-label="Close navigation">
          <X size={18} />
        </button>
      </div>

      <nav className="sidebar-nav">
        {NAV.map((group, g) => (
          <div key={group.label} className="nav-group">
            <div className="nav-group-label">{group.label}</div>
            <ul>
              {group.items
                .filter((item) => !item.adminOnly || user.role === 'admin')
                .map((item, i) => {
                  const active = item.isActive(location);
                  const Icon = item.icon;
                  return (
                    <li key={item.label}>
                      <Link
                        ref={g === 0 && i === 0 ? firstLink : undefined}
                        to={item.to}
                        className={`nav-link${active ? ' active' : ''}`}
                        aria-current={active ? 'page' : undefined}
                        onClick={onClose}
                      >
                        <Icon size={17} strokeWidth={1.9} aria-hidden="true" />
                        <span>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="sidebar-user">
        <span className="avatar">{initials(user.name)}</span>
        <span className="sidebar-user-text">
          <span className="sidebar-user-name">{user.name}</span>
          <span className="sidebar-user-role">{user.role === 'admin' ? 'Administrator' : 'Agent'}</span>
        </span>
        <button type="button" className="icon-btn" onClick={onSignOut} aria-label="Sign out" title="Sign out">
          <LogOut size={17} />
        </button>
      </div>
    </aside>
  );
}

function UserMenu({ user, onSignOut }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="user-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="avatar avatar-sm">{initials(user.name)}</span>
        <span className="user-menu-text">
          <span className="user-menu-name">{user.name}</span>
          <span className="user-menu-role">{user.role}</span>
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div className="menu" role="menu" id={menuId}>
          <div className="menu-header">
            <div className="menu-name">{user.name}</div>
            <div className="menu-email">{user.email}</div>
          </div>
          <button type="button" role="menuitem" className="menu-item" onClick={onSignOut}>
            <LogOut size={15} aria-hidden="true" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function HeaderSearch() {
  const navigate = useNavigate();
  const location = useLocation();
  const current = location.pathname === '/tickets' ? (new URLSearchParams(location.search).get('search') ?? '') : '';
  const [value, setValue] = useState(current);
  useEffect(() => setValue(current), [current]);

  return (
    <form
      className="header-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        navigate(q ? ticketsLink({ search: q }) : '/tickets');
      }}
    >
      <Search size={15} aria-hidden="true" />
      <input
        type="search"
        aria-label="Search tickets by subject, customer name or email"
        placeholder="Search tickets…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </form>
  );
}

const STATUS_TEXT = {
  connecting: { label: 'Connecting', description: 'Connecting to live updates…' },
  connected: { label: 'Live', description: 'Live updates are on.' },
  reconnecting: { label: 'Reconnecting', description: 'Reconnecting to live updates. Everything else keeps working.' },
  offline: { label: 'Offline', description: 'Live updates are paused. Everything else keeps working; refresh to see changes.' },
};

/** Real-time connection state; never shown as live before the socket has connected. */
function ConnectionStatus() {
  const status = useRealtimeStatus();
  const { label, description } = STATUS_TEXT[status] ?? STATUS_TEXT.offline;
  return (
    <span className={`connection connection-${status}`} role="status" title={description}>
      <span className="connection-dot" aria-hidden="true" />
      <span className="connection-label">{label}</span>
      <span className="sr-only">{description}</span>
    </span>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();

  // One real-time connection per signed-in session; closed on sign-out or user change.
  useEffect(() => {
    realtime.start();
    return () => realtime.stop();
  }, [user.id]);
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [section, page] = pageContext(location);

  // Close the drawer on navigation, and on Escape.
  useEffect(() => setDrawerOpen(false), [location.pathname, location.search]);
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setDrawerOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [drawerOpen]);

  return (
    <div className="app-shell">
      <Sidebar user={user} open={drawerOpen} onClose={() => setDrawerOpen(false)} onSignOut={logout} />
      {drawerOpen && <button type="button" className="drawer-backdrop" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} />}

      <div className="shell-main">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn menu-toggle"
            aria-label="Open navigation"
            aria-controls="app-sidebar"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <Menu size={19} />
          </button>
          <div className="topbar-context">
            <span className="topbar-section">{section}</span>
            <span className="topbar-sep" aria-hidden="true">
              /
            </span>
            <span className="topbar-page">{page}</span>
          </div>
          <div className="topbar-actions">
            <ConnectionStatus />
            <HeaderSearch />
            <Link to="/tickets/new" className="btn btn-primary">
              <Plus size={16} aria-hidden="true" />
              <span className="btn-label">New ticket</span>
            </Link>
            <UserMenu user={user} onSignOut={logout} />
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
