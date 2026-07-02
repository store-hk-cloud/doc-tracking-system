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
    { path: '/admin/users', label: '👥 จัดการผู้ใช้', roles: ['super_admin'] },
    { path: '/admin/departments', label: '🏢 จัดการหน่วยงาน', roles: ['super_admin'] },
  ];

  return (
    <aside
      className="side-panel"
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
      <div style={{ padding: '20px 16px 12px' }}>
        <div className="title-badge" style={{ marginBottom: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="20" height="18" rx="2" />
            <path d="M12 3v18M6 9h4M6 13h4" />
          </svg>
          DOC TRACKING
        </div>
        <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, lineHeight: 1.3 }}>
          ระบบรับ-ส่งจดหมายพัสดุ
        </h3>
        <div className="title-accent" style={{ width: 40, marginTop: 8 }} />
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

      <div style={{ padding: '12px', borderTop: '1px solid var(--line)' }}>
        <div className="account-pill" style={{ width: '100%' }}>
          <span style={{ fontWeight: 700 }}>{profile?.full_name || 'ผู้ใช้'}</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>({profile?.role === 'super_admin' ? 'ผู้ดูแลระบบ' : profile?.role === 'admin' ? 'ธุรการ' : 'ผู้ใช้'})</span>
        </div>
      </div>
    </aside>
  );
}