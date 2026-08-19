'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isNavItemActive, visibleNavItems } from '@/lib/nav-items';

export function Sidebar() {
  const { profile } = useAuth();
  const pathname = usePathname();
  const role = profile?.role;

  // เมนูมาจาก src/lib/nav-items.ts ที่เดียวกับ AppLayout (mobile)
  const items = visibleNavItems(profile);

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
          {/* --primary บนพื้นการ์ดได้ 4.49:1 ตกเกณฑ์ 4.5:1 — --primary-strong พลิกค่า
              ถูกทั้งสองธีมและได้ 6.81:1 */}
          <h3 style={{ fontSize: '0.95rem', fontWeight: 800, margin: 0, lineHeight: 1.25, color: 'var(--primary-strong)' }}>
            จดหมาย พัสดุ<br />เอกสารภายใน
          </h3>
          <div className="title-accent" style={{ width: 32, height: 3, marginTop: 6, animation: 'none' }} />
        </div>
      </div>

      <nav className="sidebar-menu" style={{ flex: 1, padding: '8px 12px', overflowY: 'auto' }}>
        {items.map((item) => (
          <Link
            key={item.path}
            href={item.path}
            className={`sidebar-item ${isNavItemActive(item, pathname) ? 'active' : ''}`}
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
        {role === 'super_admin' && (
          <a
            href="/api/admin/backfill-sheets"
            target="_blank"
            rel="noopener noreferrer"
            className="sidebar-item"
            style={{ textDecoration: 'none', marginBottom: 4 }}
          >
            🔄 อัปเดตข้อมูลเก่าใน Sheets
          </a>
        )}
        <div className="account-pill" style={{ width: '100%' }}>
          <span style={{ fontWeight: 700 }}>{profile?.full_name || 'ผู้ใช้'}</span>
          {/* แสดง department code ต่อท้ายด้วย เพื่อให้ผู้ใช้ภาคสนามตรวจเองได้ว่า
              ล็อกอินถูกบัญชี — สิทธิ์ของโมดูลเงินสดขึ้นกับแผนก ไม่ใช่แค่ role */}
          <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
            ({profile?.role === 'super_admin' ? 'ผู้ดูแลระบบ' : profile?.role === 'admin' ? 'ธุรการ' : 'ผู้ใช้'}
            {profile?.department_code ? ` · ${profile.department_code}` : ''})
          </span>
        </div>
      </div>
    </aside>
  );
}
