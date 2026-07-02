'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const isLoginPage = pathname === '/';

  if (loading) {
    return <div className="loading-screen">กำลังโหลด...</div>;
  }

  if (isLoginPage || !user) {
    return <>{children}</>;
  }

  return (
    <div className="flex" style={{ minHeight: '100vh' }}>
      <Sidebar />
      <div style={{ flex: 1, marginLeft: 280, minWidth: 0 }}>
        <Topbar />
        <main className="app-shell">{children}</main>
      </div>
    </div>
  );
}