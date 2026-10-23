import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchBranding, listWorkspaces, WorkspaceSummary } from '../api';
import { clearSession, selectWorkspace, selectedWorkspaceId } from '../session';

/**
 * Shell for workspace-scoped pages. The workspace switcher lists the caller's
 * own memberships (never an arbitrary id) and switching re-selects the
 * X-Workspace value the API client sends.
 *
 * Menu, left to right: brand lockup → pill navigation with icons → workspace
 * switcher, "all workspaces" shortcut, and an avatar account menu.
 */

const NAV_ITEMS: { to: string; label: string; icon: ReactNode }[] = [
  {
    to: '/roster',
    label: 'Roster',
    icon: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
  },
  {
    to: '/offers',
    label: 'Offers',
    icon: (
      <>
        <rect x="2" y="7" width="20" height="14" rx="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </>
    ),
  },
  {
    to: '/board',
    label: 'Board',
    icon: (
      <>
        <rect x="3" y="4" width="5" height="16" rx="1.5" />
        <rect x="9.5" y="4" width="5" height="11" rx="1.5" />
        <rect x="16" y="4" width="5" height="7" rx="1.5" />
      </>
    ),
  },
  {
    to: '/reports',
    label: 'Reports',
    icon: (
      <>
        <path d="M3 3v18h18" />
        <path d="M18 17V9" />
        <path d="M13 17V5" />
        <path d="M8 17v-3" />
      </>
    ),
  },
  {
    to: '/performance',
    label: 'Performance',
    icon: (
      <>
        <path d="M3 3v18h18" />
        <rect x="7" y="12" width="3" height="6" />
        <rect x="12" y="8" width="3" height="10" />
        <rect x="17" y="5" width="3" height="13" />
      </>
    ),
  },
  {
    to: '/office-hours',
    label: 'Office hours',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  },
  {
    to: '/intros',
    label: 'Intros',
    icon: (
      <>
        <path d="M8 12h8" />
        <path d="M12 8v8" />
        <circle cx="12" cy="12" r="9" />
      </>
    ),
  },
  {
    to: '/pods',
    label: 'Pods',
    icon: (
      <>
        <circle cx="7" cy="8" r="3" />
        <circle cx="17" cy="8" r="3" />
        <circle cx="12" cy="17" r="3" />
      </>
    ),
  },
  {
    to: '/engagement',
    label: 'Engagement',
    icon: (
      <>
        <path d="M3 12h4l2.5-6 3 12 2.5-6H21" />
      </>
    ),
  },
  {
    to: '/pricing',
    label: 'Pricing',
    icon: (
      <>
        <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
        <path d="M7 7h.01" />
      </>
    ),
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: (
      <>
        <path d="M20 7h-9" />
        <path d="M14 17H5" />
        <circle cx="17" cy="17" r="3" />
        <circle cx="7" cy="7" r="3" />
      </>
    ),
  },
];

function Icon({
  children,
  size = 16,
  className,
}: {
  children: ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

interface SessionUser {
  displayName?: string;
  email?: string;
}

/** The user saved at login/register — read once per mount, never sent anywhere. */
function readStoredUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem('roster.user');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionUser;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function initialsOf(user: SessionUser | null): string {
  const raw = user?.displayName?.trim() || user?.email || 'User';
  const words = raw.includes('@')
    ? raw.split('@')[0].split(/[.\s_-]+/)
    : raw.split(/\s+/);
  const clean = words.filter(Boolean);
  const text =
    clean.length >= 2
      ? `${clean[0][0]}${clean[1][0]}`
      : (clean[0] ?? 'U').slice(0, 2);
  return text.toUpperCase();
}

export default function Layout() {
  const navigate = useNavigate();
  const { data: workspaces } = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
  });
  const activeId = selectedWorkspaceId();
  const active: WorkspaceSummary | undefined =
    workspaces?.find((w) => w.id === activeId);
  const [user] = useState(readStoredUser);

  // White-label branding: the workspace's accent color drives the --accent
  // CSS variable (and its logo replaces the wordmark in the header).
  const { data: branding } = useQuery({
    queryKey: ['branding'],
    queryFn: fetchBranding,
    enabled: activeId != null,
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    if (branding?.accentColor) {
      document.documentElement.style.setProperty('--accent', branding.accentColor);
      return () => {
        document.documentElement.style.removeProperty('--accent');
      };
    }
  }, [branding?.accentColor]);

  // Pill nav: with 11 items the row scrolls inside itself (see .mainnav) —
  // flag when it actually overflows so the edge fades only show then, and
  // keep the active pill in view after each navigation.
  const navRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    const sync = () =>
      nav.classList.toggle('nav-scrollable', nav.scrollWidth > nav.clientWidth + 2);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(nav);
    window.addEventListener('resize', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, []);
  useEffect(() => {
    navRef.current
      ?.querySelector('a.active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [pathname]);

  // The account menu is a plain <details>; close it on outside click / Escape.
  const menuRef = useRef<HTMLDetailsElement>(null);
  function closeMenu() {
    if (menuRef.current) {
      menuRef.current.open = false;
    }
  }
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const menu = menuRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) {
        menu.open = false;
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeMenu();
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  function switchWorkspace(id: number) {
    const target = workspaces?.find((w) => w.id === id);
    if (target) {
      selectWorkspace(target);
      navigate('/roster');
      window.location.reload();
    }
  }

  function logout() {
    clearSession();
    navigate('/login');
  }

  return (
    <div className="app-shell">
      <header className="topnav">
        <span className="brand">
          {branding?.logoUrl ? (
            <img className="brand-logo" src={branding.logoUrl} alt={active?.name ?? 'Logo'} />
          ) : (
            <span className="brand-text">
              <span className="brand-name">Roster</span>
              <span className="brand-by">by Coeso</span>
            </span>
          )}
        </span>

        <nav className="mainnav" aria-label="Main navigation" ref={navRef}>
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to}>
              <Icon>{item.icon}</Icon>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="nav-end">
          {active && (
            <div className="ws-switch">
              <span className="ws-avatar" aria-hidden="true">
                {active.name.trim().charAt(0).toUpperCase() || '?'}
              </span>
              <span className="ws-name">{active.name}</span>
              <select
                aria-label="Active workspace"
                value={active.id}
                onChange={(e) => switchWorkspace(Number(e.target.value))}
              >
                {workspaces?.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <Icon size={14} className="chev">
                <path d="m6 9 6 6 6-6" />
              </Icon>
            </div>
          )}

          <span className="nav-divider" aria-hidden="true" />

          <button
            type="button"
            className="nav-icon-btn"
            aria-label="All workspaces"
            title="All workspaces"
            onClick={() => navigate('/workspaces')}
          >
            <Icon>
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </Icon>
          </button>

          <details className="user-menu" ref={menuRef} aria-label="Account menu">
            <summary className="user-summary" title={user?.displayName ?? 'Account'}>
              <span className="avatar">{initialsOf(user)}</span>
            </summary>
            <div className="user-pop">
              <div className="who">
                <div className="who-name">{user?.displayName || 'Signed in'}</div>
                {user?.email && <div className="who-email">{user.email}</div>}
                {active && (
                  <div className="who-role">
                    {active.role.charAt(0) + active.role.slice(1).toLowerCase()} ·{' '}
                    {active.name}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="pop-item"
                onClick={() => {
                  closeMenu();
                  navigate('/workspaces');
                }}
              >
                <Icon>
                  <rect x="3" y="3" width="7" height="7" rx="1.5" />
                  <rect x="14" y="3" width="7" height="7" rx="1.5" />
                  <rect x="3" y="14" width="7" height="7" rx="1.5" />
                  <rect x="14" y="14" width="7" height="7" rx="1.5" />
                </Icon>
                All workspaces
              </button>
              <button
                type="button"
                className="pop-item pop-danger"
                onClick={() => {
                  closeMenu();
                  logout();
                }}
              >
                <Icon>
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <path d="m16 17 5-5-5-5" />
                  <path d="M21 12H9" />
                </Icon>
                Log out
              </button>
            </div>
          </details>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
