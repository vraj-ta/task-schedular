import {
  Calendar,
  ChevronDown,
  ClipboardList,
  Cpu,
  LayoutDashboard,
  LogOut,
  Plus,
  Server,
  Users,
  Zap,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext.js';
import { Button } from '../components/primitives.js';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={15} />, end: true },
    ],
  },
  {
    label: 'Workload',
    items: [
      { to: '/jobs', label: 'Jobs', icon: <ClipboardList size={15} /> },
      { to: '/schedules', label: 'Schedules', icon: <Calendar size={15} /> },
    ],
  },
  {
    label: 'Infrastructure',
    items: [
      { to: '/platforms', label: 'Platforms', icon: <Server size={15} /> },
      { to: '/workers', label: 'Workers', icon: <Cpu size={15} /> },
    ],
  },
  {
    label: 'Settings',
    items: [
      { to: '/admins', label: 'Admins', icon: <Users size={15} /> },
    ],
  },
];

const PAGE_TITLE: Record<string, string> = {
  '/': 'Dashboard',
  '/jobs': 'Jobs',
  '/jobs/new': 'Create job',
  '/schedules': 'Schedules',
  '/platforms': 'Platforms',
  '/workers': 'Workers',
  '/admins': 'Admins',
};

const initials = (email: string): string => {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return (local.slice(0, 2) || '?').toUpperCase();
};

export const AppLayout = ({ children }: { children: ReactNode }) => {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const pageTitle = useMemo(() => {
    if (PAGE_TITLE[location.pathname]) return PAGE_TITLE[location.pathname];
    if (location.pathname.startsWith('/jobs/')) return 'Job detail';
    return '';
  }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark"><Zap size={18} /></div>
          <div style={{ minWidth: 0 }}>
            <div className="sidebar-brand-text">Task Scheduler</div>
            <div className="sidebar-brand-sub">Operator console</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {SECTIONS.map((section) => (
            <div key={section.label}>
              <div className="sidebar-section-label">{section.label}</div>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    ['sidebar-item', isActive ? 'active' : ''].filter(Boolean).join(' ')
                  }
                >
                  <span className="sidebar-item-icon">{item.icon}</span>
                  <span className="sidebar-item-label">{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="footer-pulse" />
          <span className="u-truncate">Phase 1 · in-process worker</span>
        </div>
      </aside>

      <header className="app-topbar">
        <div className="u-grow">
          <span className="topbar-title">{pageTitle}</span>
        </div>
        <div className="topbar-actions">
          <Link to="/jobs/new">
            <Button variant="primary" size="sm" iconLeft={<Plus size={14} />}>New job</Button>
          </Link>
          <div style={{ position: 'relative' }}>
            <button className="user-menu" onClick={() => setMenuOpen((v) => !v)}>
              <div className="user-avatar">
                {session ? initials(session.admin.email) : '?'}
              </div>
              <span className="u-row" style={{ fontSize: 12 }}>
                <span style={{ color: 'var(--text-1)' }}>{session?.admin.displayName ?? session?.admin.email}</span>
                <ChevronDown size={13} style={{ color: 'var(--text-3)' }} />
              </span>
            </button>
            {menuOpen && (
              <>
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 50 }}
                  onClick={() => setMenuOpen(false)}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: '110%',
                    right: 0,
                    background: 'var(--bg-1)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-3)',
                    boxShadow: 'var(--shadow-lg)',
                    minWidth: 220,
                    padding: 6,
                    zIndex: 60,
                  }}
                >
                  <div style={{ padding: '8px 10px 10px', borderBottom: '1px solid var(--border)', marginBottom: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-0)' }}>
                      {session?.admin.displayName}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{session?.admin.email}</div>
                  </div>
                  <button
                    className="sidebar-item"
                    style={{ width: '100%', textAlign: 'left' }}
                    onClick={() => { setMenuOpen(false); void handleLogout(); }}
                  >
                    <LogOut size={14} />
                    <span>Sign out</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="app-main">{children}</main>
    </div>
  );
};
