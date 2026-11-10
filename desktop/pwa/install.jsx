import { useEffect, useState } from 'react';
export function PwaInstall() {
  const [prompt, setPrompt] = useState(null);
  const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches);
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const ready = event => { event.preventDefault(); setPrompt(event); };
    const done = () => { setInstalled(true); setPrompt(null); };
    const network = () => setOffline(!navigator.onLine);
    window.addEventListener('beforeinstallprompt', ready);
    window.addEventListener('appinstalled', done);
    window.addEventListener('online', network);
    window.addEventListener('offline', network);
    navigator.serviceWorker?.register(__PWA_BASE__ + 'sw.js', {scope: __PWA_BASE__}).catch(() => {});
    return () => {
      window.removeEventListener('beforeinstallprompt', ready);
      window.removeEventListener('appinstalled', done);
      window.removeEventListener('online', network);
      window.removeEventListener('offline', network);
    };
  }, []);
  return <aside className="search-panel" aria-label="ติดตั้งแอป">
    {!installed && <>{prompt ? <button className="primary-button" type="button" onClick={async () => {
      await prompt.prompt(); await prompt.userChoice; setPrompt(null);
    }}>ติดตั้งแอปบน Windows</button> : <p>ติดตั้งใน Microsoft Edge: เปิดเมนู … → แอป → ติดตั้งไซต์นี้เป็นแอป</p>}</>}
    <p role={offline ? 'alert' : undefined}>{offline ? 'ขณะนี้ออฟไลน์ — กรุณาเชื่อมต่ออินเทอร์เน็ตก่อนใช้งาน' : 'การค้นหา บันทึก และลงชื่อรับเอกสารต้องเชื่อมต่ออินเทอร์เน็ต'}</p>
  </aside>;
}
