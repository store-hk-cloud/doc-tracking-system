'use client';

import { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { canAccessMessengerArea } from '@/lib/capabilities';

// guard ครั้งเดียวสำหรับทุกหน้าใน segment
// นี่เป็นแค่ UX — middleware ไม่เช็ค role/dept ทุก API route จึง gate ซ้ำที่ server
export default function MessengerLayout({ children }: { children: ReactNode }) {
  const { profile, loading } = useAuth();
  const router = useRouter();
  const allowed = canAccessMessengerArea(profile);

  useEffect(() => {
    if (!loading && !allowed) router.replace('/dashboard');
  }, [loading, allowed, router]);

  if (loading) return <div className="loading-screen">Loading...</div>;
  if (!allowed) {
    return (
      <div className="scan-panel">
        <div className="toast error" style={{ position: 'static' }}>
          หน้านี้สำหรับแผนกแมสเซนเจอร์เท่านั้น
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
