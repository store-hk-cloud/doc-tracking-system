import { useEffect, useRef, useState } from 'react';
import Image from '../full-ui/image.jsx';
export function PwaInstall() {
  const [prompt, setPrompt] = useState(null);
  const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [status, setStatus] = useState('');
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const ready = event => { event.preventDefault(); setPrompt(event); };
    const done = () => { setInstalled(true); setPrompt(null); setStatus(''); };
    const network = () => setOffline(!navigator.onLine);
    window.addEventListener('beforeinstallprompt', ready);
    window.addEventListener('appinstalled', done);
    window.addEventListener('online', network);
    window.addEventListener('offline', network);
    navigator.serviceWorker?.register(__PWA_BASE__ + 'sw.js', {scope: __PWA_BASE__}).catch(() => {});
    return () => {
      mounted.current = false;
      window.removeEventListener('beforeinstallprompt', ready);
      window.removeEventListener('appinstalled', done);
      window.removeEventListener('online', network);
      window.removeEventListener('offline', network);
    };
  }, []);

  async function install() {
    if (!prompt || pending.current) return;
    pending.current = true;
    setPrompt(null);
    setStatus('กำลังเปิดหน้าต่างติดตั้ง…');
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (mounted.current) setStatus(choice?.outcome === 'accepted'
        ? 'Edge กำลังติดตั้งแอปให้คุณ'
        : 'ยกเลิกการติดตั้งแล้ว สามารถติดตั้งอีกครั้งผ่านเมนูของเบราว์เซอร์');
    } catch {
      if (mounted.current) setStatus('เปิดหน้าต่างติดตั้งไม่ได้ กรุณาติดตั้งผ่านเมนูของเบราว์เซอร์');
    } finally {
      pending.current = false;
    }
  }

  return <aside className="search-panel" aria-label="ติดตั้งแอป">
    {installed ? <p role="status">ติดตั้งเรียบร้อย เปิดแอปจากไอคอนบนเครื่องหรือเมนู Start ได้เลย</p>
      : <>
        {prompt && <button className="primary-button" type="button" onClick={install}>ติดตั้งแอป</button>}
        {status && <p role="status">{status}</p>}
        {!prompt && <p>หากไม่มีหน้าต่างติดตั้ง ให้เปิดเมนู … ของ Microsoft Edge → แอป → ติดตั้งไซต์นี้เป็นแอป</p>}
      </>}
    <p role={offline ? 'alert' : undefined}>{offline ? 'ขณะนี้ออฟไลน์ — กรุณาเชื่อมต่ออินเทอร์เน็ตก่อนใช้งาน' : 'การค้นหา บันทึก และลงชื่อรับเอกสารต้องเชื่อมต่ออินเทอร์เน็ต'}</p>
  </aside>;
}

export function PwaInstallPage() {
  return <main className="auth-page">
    <section className="scan-panel auth-card">
      <Image src="/icons/hillkoff-emblem.png" alt="Hillkoff" width={64} height={64} />
      <h1>ติดตั้งแอป Hillkoff</h1>
      <p>ติดตั้งเพื่อเปิดจากไอคอนบนเครื่อง ใช้บัญชีเดิมได้ทุกแผนก</p>
      <PwaInstall />
      <a href={__PWA_BASE__ + '#/'} className="ghost-button">เข้าใช้งานระบบ</a>
    </section>
  </main>;
}
