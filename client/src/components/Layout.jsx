import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand">
          Comhord
        </Link>
        <nav className="nav">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/tickets" end>
            Tickets
          </NavLink>
          {user.role === 'admin' && <NavLink to="/analytics">Analytics</NavLink>}
        </nav>
        <Link to="/tickets/new" className="btn btn-primary">
          + New ticket
        </Link>
        <div className="user-menu">
          <span className="user-name">{user.name}</span>
          <span className={`role-tag role-${user.role}`}>{user.role}</span>
          <button type="button" className="btn btn-link" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
