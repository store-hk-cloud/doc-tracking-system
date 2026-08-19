'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ReactNode, useState } from 'react';
import { isNavItemActive, splitMobileNav } from '@/lib/nav-items';

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, profile, loading } = useAuth();
  const pathname = usePathname();
  const [showMore, setShowMore] = useState(false);
  const isLoginPage = pathname === '/';

  // เมนูมาจาก src/lib/nav-items.ts ที่เดียวกับ Sidebar เพื่อไม่ให้สองที่ขัดกัน
  const { primary, overflow } = splitMobileNav(profile);

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
        {primary.map((item) => {
          const isActive = isNavItemActive(item, pathname);
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`mobile-nav-item ${isActive ? 'active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="mobile-nav-icon">{item.icon}</span>
              <span>{item.shortLabel}</span>
            </Link>
          );
        })}
        {overflow.length > 0 && (
          <button
            type="button"
            className={`mobile-nav-item ${showMore ? 'active' : ''}`}
            onClick={() => setShowMore(true)}
            aria-expanded={showMore}
            aria-haspopup="menu"
          >
            <span className="mobile-nav-icon">More</span>
            <span>เพิ่มเติม</span>
          </button>
        )}
      </nav>

      {showMore && (
        <div className="scan-popup-overlay" onClick={() => setShowMore(false)}>
          <div className="scan-popup-sheet" onClick={(e) => e.stopPropagation()} role="menu">
            <div className="scan-popup-handle" />
            <h3 style={{ margin: '0 0 12px' }}>เมนูเพิ่มเติม</h3>
            {overflow.map((item) => (
              <Link
                key={item.path}
                href={item.path}
                className={`sidebar-item ${isNavItemActive(item, pathname) ? 'active' : ''}`}
                onClick={() => setShowMore(false)}
                role="menuitem"
              >
                {item.label}
              </Link>
            ))}
            <button
              type="button"
              className="scan-popup-close"
              onClick={() => setShowMore(false)}
              aria-label="ปิดเมนู"
            >
              ปิด
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
