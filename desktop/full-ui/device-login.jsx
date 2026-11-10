import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { startDeviceLogin } from '../device-auth/client.mjs';
import { completeDeviceLogin } from './device-login.mjs';
import { createClient } from './supabase-client.mjs';

export function DeviceLogin() {
  const [card, setCard] = useState(null);
  const [status, setStatus] = useState(null);
  const active = useRef(null);

  useLayoutEffect(() => {
    setCard(document.querySelector('.auth-card'));
  }, []);

  useEffect(() => () => active.current?.abort(), []);

  async function begin() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setStatus({ pending: true });

    try {
      await completeDeviceLogin({
        origin: __DESKTOP_WEB_ORIGIN__,
        supabaseUrl: __SUPABASE_ORIGIN__,
        publicKey: __SUPABASE_PUBLISHABLE_KEY__,
        startDeviceLogin,
        setSession: (tokens) => {
          setStatus({ applying: true });
          return createClient().auth.setSession(tokens);
        },
        openBrowser: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
        signal: controller.signal,
        onCode: (code) => {
          if (!controller.signal.aborted) setStatus({ pending: true, code });
        },
      });
      window.location.replace('/dashboard');
    } catch {
      if (!controller.signal.aborted) {
        setStatus({ error: 'เข้าสู่ระบบผ่านเว็บไม่สำเร็จ กรุณาลองอีกครั้ง' });
      }
    } finally {
      if (active.current === controller) active.current = null;
    }
  }

  function cancel() {
    active.current?.abort();
    active.current = null;
    setStatus(null);
  }

  if (!card) return null;
  return createPortal(
    <div style={{ marginTop: 16, textAlign: 'center' }}>
      {status?.pending ? (
        <>
          <p role="status">
            {status.code ? <>ตรวจสอบรหัส <strong>{status.code}</strong> บนเว็บ แล้วกดอนุมัติการเข้าสู่ระบบ</>
              : 'กำลังเปิดหน้าสำหรับยืนยันการเข้าสู่ระบบ…'}
          </p>
          <button type="button" className="ghost-button" onClick={cancel}>ยกเลิก</button>
        </>
      ) : (
        <>
          {status?.error && <p role="alert">{status.error}</p>}
          <button type="button" className="ghost-button" onClick={begin} disabled={status?.applying}>
            {status?.applying ? 'กำลังเข้าสู่ระบบ…' : 'ใช้บัญชีที่ล็อกอินบนเว็บ'}
          </button>
        </>
      )}
    </div>,
    card,
  );
}
