'use client';

import { useAuth } from '@/components/auth/AuthProvider';

export function Topbar() {
  const { profile, signOut } = useAuth();

  return (
    <div className="topbar">
      <div className="topbar-actions">
        <span className="topbar-email">
          {profile?.email}
        </span>
        <button className="ghost-button topbar-signout" onClick={signOut}>
          ออกจากระบบ
        </button>
      </div>
    </div>
  );
}
