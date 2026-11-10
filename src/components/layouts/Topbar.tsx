'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export function Topbar() {
  const { profile, signOut } = useAuth();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showPanel, setShowPanel] = useState(false);
  const inFlight = useRef(false);
  const clearing = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(false);
  const lastRefresh = useRef(-Infinity);

  const loadNotifications = useCallback(async () => {
    if (document.visibilityState !== 'visible' || inFlight.current || clearing.current
      || Date.now() - lastRefresh.current < 1000) return;
    inFlight.current = true;
    lastRefresh.current = Date.now();
    const version = generation.current;
    try {
      const res = await window.fetch('/api/notifications');
      const data = await res.json();
      if (data.success && mounted.current && version === generation.current) setNotifications(data.data);
    } catch (e) {
      console.error('fetch notifications error:', e);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let interval: ReturnType<typeof setInterval> | undefined;
    const updateVisibility = () => {
      if (interval !== undefined) clearInterval(interval);
      interval = undefined;
      if (document.visibilityState === 'visible') {
        loadNotifications();
        interval = setInterval(loadNotifications, 60000);
      }
    };
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    window.addEventListener('focus', loadNotifications);
    return () => {
      mounted.current = false;
      if (interval !== undefined) clearInterval(interval);
      document.removeEventListener('visibilitychange', updateVisibility);
      window.removeEventListener('focus', loadNotifications);
    };
  }, [loadNotifications]);

  const handleClear = async () => {
    if (clearing.current) return;
    clearing.current = true;
    // ผลอ่านที่เริ่มก่อนล้างต้องไม่เติมรายการเก่ากลับมาหลัง DELETE สำเร็จ
    generation.current += 1;
    try {
      await window.fetch('/api/notifications', { method: 'DELETE' });
      if (mounted.current) {
        setNotifications([]);
        setShowPanel(false);
      }
    } finally {
      clearing.current = false;
    }
  };

  return (
    <div className="topbar">
      <div className="topbar-actions" style={{ position: 'relative' }}>
        <Link href="/policies" className="topbar-help-link">📚 คู่มือ</Link>
        {profile && (
          <a className="topbar-help-link desktop-download"
            href="https://store-hk-cloud.github.io/doc-tracking-system/?install=1" target="_blank" rel="noopener noreferrer">
            ติดตั้งแอป
          </a>
        )}
        <button
          className="ghost-button"
          onClick={() => setShowPanel((v) => !v)}
          style={{ width: 'auto', padding: '0 12px', position: 'relative' }}
        >
          🔔
          {notifications.length > 0 && (
            <span
              style={{
                position: 'absolute', top: -4, right: -4, background: 'var(--danger)',
                // ขาวบน --danger ได้แค่ 3.34:1 ใน dark theme ซึ่งตกเกณฑ์ 4.5:1
                // ที่ขนาด 0.7rem — ใช้ --notify-badge-fg ที่พลิกตามธีมแทน
                color: 'var(--notify-badge-fg)',
                borderRadius: 999, fontSize: '0.7rem', minWidth: 16, height: 16, lineHeight: '16px',
                textAlign: 'center', fontWeight: 800, padding: '0 3px',
              }}
            >
              {notifications.length}
            </span>
          )}
        </button>

        {showPanel && (
          <div
            style={{
              position: 'absolute', top: '110%', right: 0, width: 320, maxHeight: 360, overflowY: 'auto',
              background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10,
              boxShadow: '0 12px 32px rgba(31,45,61,0.16)', zIndex: 200, padding: 10,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: '0.9rem' }}>🔔 การแจ้งเตือน</strong>
              {notifications.length > 0 && (
                <button className="ghost-button" onClick={handleClear} style={{ width: 'auto', padding: '0 10px', minHeight: 30, fontSize: '0.78rem' }}>
                  ล้างทั้งหมด
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: '0.85rem', padding: '10px 0', textAlign: 'center' }}>
                ไม่มีการแจ้งเตือน
              </div>
            ) : (
              notifications.map((n: any, i: number) => (
                <div key={i} style={{ padding: '8px 0', borderTop: i > 0 ? '1px solid var(--line)' : 'none' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{n.title}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{n.body}</div>
                </div>
              ))
            )}
          </div>
        )}

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
