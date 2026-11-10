'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthProvider';
import { createClient } from '@/lib/supabase/client';
import { getSupabasePublicKey, getSupabaseUrl } from '@/lib/supabase/env';
import { getComparisonCode, isDeviceSecret } from '../../../../desktop/device-auth/shared.mjs';

export default function DesktopConnectPage() {
  const { user } = useAuth();
  const [challenge, setChallenge] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const url = new URL(window.location.href);
    const value = url.searchParams.get('challenge');
    if (value && isDeviceSecret(value)) setChallenge(value);
    url.searchParams.delete('challenge');
    window.history.replaceState(window.history.state, '', url);
  }, []);

  async function approve() {
    if (!challenge || !user || loading || approved) return;
    setLoading(true);
    setError('');
    try {
      const { data: { session } } = await createClient().auth.getSession();
      const publicKey = getSupabasePublicKey();
      const url = getSupabaseUrl();
      if (!session || session.user.id !== user.id || !publicKey || !url) {
        setError('กรุณาเข้าสู่ระบบบนเว็บ แล้วเปิดการเชื่อมต่อใหม่จากแอปเดสก์ท็อป');
        return;
      }
      const result = await fetch(new URL('/functions/v1/desktop-device-auth', url), {
        method: 'POST',
        headers: {
          apikey: publicKey,
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        credentials: 'omit',
        redirect: 'error',
        body: JSON.stringify({ action: 'approve', challenge }),
      });
      if (result.status === 204) setApproved(true);
      else if (result.status === 409) setError('คำขอหมดอายุหรือถูกใช้แล้ว กรุณาเริ่มใหม่จากแอปเดสก์ท็อป');
      else setError('ยืนยันบัญชีไม่ได้ กรุณาตรวจสอบสถานะบัญชีและลองอีกครั้ง');
    } catch {
      setError('ติดต่อระบบไม่ได้ กรุณาลองอีกครั้ง');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="scan-panel auth-card">
        <h1>เชื่อมบัญชีกับแอปเดสก์ท็อป</h1>
        {approved ? (
          <p role="status">ยืนยันบัญชีแล้ว กลับไปที่แอปเดสก์ท็อปเพื่อใช้งานต่อได้เลย</p>
        ) : challenge ? (
          <>
            <p>ตรวจว่ารหัสนี้ตรงกับรหัสที่แสดงในแอปเดสก์ท็อปของคุณก่อนกดยืนยัน</p>
            <p><strong>{getComparisonCode(challenge)}</strong></p>
            {user && <p>บัญชีที่จะเชื่อม <strong>{user.email}</strong></p>}
            {error && <p role="alert">{error}</p>}
            <button type="button" className="secondary-button" disabled={loading || !user} onClick={approve}>
              {loading ? 'กำลังยืนยัน…' : 'ยืนยันการเชื่อมบัญชี'}
            </button>
          </>
        ) : (
          <p>เปิดหน้าต่างเชื่อมบัญชีจากแอปเดสก์ท็อปเพื่อเริ่มใช้งาน</p>
        )}
        <p><Link href="/dashboard">กลับไปหน้าหลัก</Link></p>
      </section>
    </main>
  );
}
