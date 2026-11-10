import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from '@/components/auth/AuthProvider';
import { AppLayout } from '@/components/layouts/AppLayout';
import FinanceLayout from '@/app/finance/layout';
import MessengerLayout from '@/app/messenger/layout';
import { createClient } from './supabase-client.mjs';
import { createApiFetch } from './api-fetch.mjs';
import { usePathname, useRoute, useRouter } from './navigation.jsx';
import { runSheetsAction } from './sheets.mjs';
import routes from 'desktop:routes';
import { PwaInstall } from '../pwa/install.jsx';
import { pwaHref, followFragment } from '../pwa/runtime.mjs';
import { DeviceLogin } from './device-login.jsx';

if (__PWA__) document.addEventListener('click', (event) => {
  const link = event.target.closest?.('a[href]');
  const href = link?.getAttribute('href');
  if (followFragment(href, document)) { event.preventDefault(); return; }
  if (!href?.startsWith('/') || href.startsWith('//') || href.startsWith('/api/')) return;
  if (!event.defaultPrevented && !link.target && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    const scoped = pwaHref(href, __PWA_BASE__);
    if (scoped === href || href.startsWith(__PWA_BASE__ + '#')) return;
    event.preventDefault(); window.location.href = scoped;
  }
});

window.fetch = createApiFetch({
  fetch: window.fetch.bind(window),
  location: window.location.href,
  supabaseOrigin: __SUPABASE_ORIGIN__,
  publicKey: __SUPABASE_PUBLISHABLE_KEY__,
  getAccessToken: async () => (await createClient().auth.getSession()).data.session?.access_token,
});

function DesktopPage() {
  const { user, loading } = useAuth();
  const path = usePathname();
  const match = useRoute();
  const router = useRouter();
  const destination = user && path === '/' ? '/dashboard' : !user && path !== '/' ? '/' : null;

  useEffect(() => {
    if (!loading && destination) router.replace(destination);
  }, [loading, destination, router]);

  if (loading || destination) return <div className="loading-screen">Loading...</div>;
  if (!match) {
    return <div className="search-panel">ไม่พบหน้านี้ <a href={__PWA__ ? pwaHref('/dashboard', __PWA_BASE__) : '/dashboard'}>กลับไปหน้า Dashboard</a></div>;
  }
  const Page = routes[match.route];
  const page = <Page key={path} />;
  if (path === '/' && __DESKTOP_WEB_ORIGIN__) return <>{page}<DeviceLogin /></>;

  if (path === '/messenger' || path.startsWith('/messenger/')) return <MessengerLayout>{page}</MessengerLayout>;
  if (path === '/finance' || path.startsWith('/finance/')) return <FinanceLayout>{page}</FinanceLayout>;
  return page;
}
function SheetsActions() {
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let pending = false;
    async function run(path) {
      if (pending) return;
      pending = true;
      const popup = __PWA__ && path === '/api/setup-sheets' ? window.open('about:blank', '_blank') : null;
      if (popup) popup.opener = null;
      let fallback;
      setNotice({ message: 'กำลังเชื่อมต่อ Google Sheets…' });
      try {
        const message = await runSheetsAction(path, {
          fetch: window.fetch,
          open: (url) => {
            if (!__PWA__) return window.open(url, '_blank', 'noopener,noreferrer');
            if (popup && !popup.closed) popup.location.replace(url);
            else fallback = url;
          },
        });
        setNotice(fallback ? {message: 'เปิด Google Sheets', url: fallback} : message ? { message } : null);
      } catch (error) {
        popup?.close();
        setNotice({ message: error.message, error: true });
      } finally {
        pending = false;
      }
    }

    // ลิงก์และฟอร์มเดิมใช้คุกกี้บนเว็บ ส่วนแอปส่ง session ผ่าน fetch
    const click = (event) => {
      if (!event.target.closest?.('a[href="/api/setup-sheets"]')) return;
      event.preventDefault();
      void run('/api/setup-sheets');
    };
    const submit = (event) => {
      if (!event.target.matches('form[action="/api/admin/backfill-sheets"]')) return;
      event.preventDefault();
      void run('/api/admin/backfill-sheets');
    };
    document.addEventListener('click', click, true);
    document.addEventListener('submit', submit, true);
    return () => {
      document.removeEventListener('click', click, true);
      document.removeEventListener('submit', submit, true);
    };
  }, []);

  return notice ? (
    <div role="status" className={notice.error ? 'toast error' : 'toast success'}>
      {notice.message} {notice.url && <a href={notice.url} target="_blank" rel="noopener noreferrer">เปิดตาราง</a>} <button type="button" className="ghost-button" onClick={() => setNotice(null)}>ปิด</button>
    </div>
  ) : null;
}

createRoot(document.getElementById('root')).render(
  <AuthProvider>
    <AppLayout><DesktopPage /></AppLayout>
    <SheetsActions />
    {__PWA__ && <PwaInstall />}
  </AuthProvider>,
);
