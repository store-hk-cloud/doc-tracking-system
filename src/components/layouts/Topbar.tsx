'use client';

import { useAuth } from '@/components/auth/AuthProvider';

export function Topbar() {
  const { profile, signOut } = useAuth();

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 24px',
      borderBottom: '1px solid var(--line)',
      background: 'var(--glass-bg)',
      backdropFilter: 'blur(20px)',
    }}>
      <div>
        <span style={{ color: 'var(--muted)', fontSize: '0.85rem', fontWeight: 700 }}>
          สวัสดี, {profile?.full_name || 'ผู้ใช้'}
        </span>
        {profile?.department_name && (
          <span style={{ color: 'var(--muted)', fontSize: '0.75rem', marginLeft: 12 }}>
            {profile.department_name}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: '0.82rem', color: 'var(--muted)', fontWeight: 800 }}>
          {profile?.email}
        </span>
        <button className="ghost-button" onClick={signOut} style={{ minHeight: 36, fontSize: '0.85rem', width: 'auto', padding: '0 14px' }}>
          ออกจากระบบ
        </button>
      </div>
    </div>
  );
}