'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ReactNode } from 'react';

const NAV_ITEMS = [
  { path: '/dashboard', icon: 'Home', label: 'Home', roles: ['super_admin', 'admin', 'user'] },
  { path: '/register', icon: 'Add', label: 'Register', roles: ['super_admin', 'admin'] },
  { path: '/delivery', icon: 'Send', label: 'Deliver', roles: ['super_admin', 'admin'] },
  { path: '/recipient', icon: 'Sign', label: 'Receive', roles: ['super_admin', 'admin', 'user'] },
  { path: '/tracking', icon: 'Find', label: 'Track', roles: ['super_admin', 'admin', 'user'] },
  { path: '/reports', icon: 'Stats', label: 'Reports', roles: ['super_admin', 'admin', 'user'] },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, profile, loading } = useAuth();
  const pathname = usePathname();
  const isLoginPage = pathname === '/';
  const role = profile?.role || 'user';
  const mobileItems = NAV_ITEMS.filter((item) => item.roles.includes(role)).slice(0, 5);

  if (loading) {
    return <div className="loading-screen">Loading...</div>;
  }

  if (isLoginPage || !user) {
    return <>{children}</>;
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="app-content">
        <Topbar />
        <main className="app-shell">{children}</main>
      </div>
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        {mobileItems.map((item) => (
          <Link
            key={item.path}
            href={item.path}
            className={`mobile-nav-item ${pathname.startsWith(item.path) ? 'active' : ''}`}
          >
            <span className="mobile-nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
