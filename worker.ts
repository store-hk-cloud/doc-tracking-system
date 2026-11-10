import { handleNotifications } from './src/workers/notifications';
import { handleDocumentReceipt } from './src/workers/document-receipt';
import type { NotificationsEnvironment } from './src/workers/env';

export default {
  async fetch(request: Request, env: NotificationsEnvironment, ctx: ExecutionContext) {
    const path = new URL(request.url).pathname;
    if (path === '/api/notifications') return handleNotifications(request, env);
    if (path === '/api/deliveries' && request.method === 'POST' &&
        env.DOCUMENT_RECEIPT_FAST_PATH === 'true' && env.GOOGLE_SHEETS_SYNC_MODE === 'apps_script') {
      return handleDocumentReceipt(request, env);
    }
    // โหลด Next เฉพาะเส้นทางที่ต้องใช้ เพื่อไม่ให้ API แจ้งเตือนเสีย CPU ตอนเริ่ม framework
    const { default: next } = await import('./.open-next/worker.js');
    return next.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<NotificationsEnvironment>;
