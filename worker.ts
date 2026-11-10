import { handleNotifications } from './src/workers/notifications';
import type { NotificationsEnvironment } from './src/workers/env';

export default {
  async fetch(request: Request, env: NotificationsEnvironment, ctx: ExecutionContext) {
    if (new URL(request.url).pathname === '/api/notifications') return handleNotifications(request, env);
    // โหลด Next เฉพาะเส้นทางที่ต้องใช้ เพื่อไม่ให้ API แจ้งเตือนเสีย CPU ตอนเริ่ม framework
    const { default: next } = await import('./.open-next/worker.js');
    return next.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<NotificationsEnvironment>;
