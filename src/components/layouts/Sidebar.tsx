'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Sidebar() {
  const { profile } = useAuth();
  const pathname = usePathname();
  const role = profile?.role;

  const isActive = (path: string) => pathname.startsWith(path) ? 'active' : '';

  const items = [
    { path: '/dashboard', label: '📊 Dashboard', roles: ['super_admin', 'admin', 'user'] },
    { path: '/register', label: '📝 ลงทะเบียน', roles: ['super_admin', 'admin'] },
    { path: '/delivery', label: '📦 ส่งมอบ', roles: ['super_admin', 'admin'] },
    { path: '/recipient', label: '✍️ รับเอกสาร', roles: ['super_admin', 'admin', 'user'] },
    { path: '/tracking', label: '🔍 ติดตาม', roles: ['super_admin', 'admin', 'user'] },
    { path: '/reports', label: '📈 รายงาน', roles: ['super_admin', 'admin', 'user'] },
    { path: '/policies', label: '📚 นโยบายและคู่มือ', roles: ['super_admin', 'admin', 'user'] },
    { path: '/admin/users', label: '👥 จัดการผู้ใช้', roles: ['super_admin', 'admin'] },
    { path: '/admin/departments', label: '🏢 จัดการหน่วยงาน', roles: ['super_admin'] },
  ];

  return (
    <aside
      className="side-panel desktop-sidebar"
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        bottom: 0,
        width: 280,
        borderRadius: 0,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 100,
      }}
    >
      <div style={{ padding: '20px 16px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src="/icons/hillkoff-emblem.png" alt="Hillkoff" width={38} height={38} style={{ flexShrink: 0 }} />
        <div>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 800, margin: 0, lineHeight: 1.25, color: 'var(--primary)' }}>
            จดหมาย พัสดุ<br />เอกสารภายใน
          </h3>
          <div className="title-accent" style={{ width: 32, height: 3, marginTop: 6, animation: 'none' }} />
        </div>
      </div>

      <nav className="sidebar-menu" style={{ flex: 1, padding: '8px 12px', overflowY: 'auto' }}>
        {items
          .filter((item) => item.roles.includes(role || 'user'))
          .map((item) => (
            <Link
              key={item.path}
              href={item.path}
              className={`sidebar-item ${isActive(item.path)}`}
            >
              {item.label}
            </Link>
          ))}
      </nav>

      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--line)' }}>
        <a
          href="/api/setup-sheets"
          target="_blank"
          rel="noopener noreferrer"
          className="sidebar-item"
          style={{ textDecoration: 'none', marginBottom: 4 }}
        >
          📗 ไปยัง Google Sheets
        </a>
        <div className="account-pill" style={{ width: '100%' }}>
          <span style={{ fontWeight: 700 }}>{profile?.full_name || 'ผู้ใช้'}</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>({profile?.role === 'super_admin' ? 'ผู้ดูแลระบบ' : profile?.role === 'admin' ? 'ธุรการ' : 'ผู้ใช้'})</span>
        </div>
      </div>
    </aside>
  );
}
