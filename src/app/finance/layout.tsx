'use client';

import { ReactNode, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { canAccessFinanceArea } from '@/lib/capabilities';

// guard ครั้งเดียวสำหรับทุกหน้าใน segment — ทุก API route gate ซ้ำที่ server
export default function FinanceLayout({ children }: { children: ReactNode }) {
  const { profile, loading } = useAuth();
  const router = useRouter();
  const allowed = canAccessFinanceArea(profile);

  useEffect(() => {
    if (!loading && !allowed) router.replace('/dashboard');
  }, [loading, allowed, router]);

  if (loading) return <div className="loading-screen">Loading...</div>;
  if (!allowed) {
    return (
      <div className="scan-panel">
        <div className="toast error" style={{ position: 'static' }}>
          หน้านี้สำหรับฝ่ายการเงิน/บัญชีเท่านั้น
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
