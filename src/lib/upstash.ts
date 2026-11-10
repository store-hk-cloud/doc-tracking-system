import { getCloudflareContext } from '@opennextjs/cloudflare';
import { randomUUID } from 'crypto';

import { readNotifications, removeNotifications, type Notification, type NotificationKv } from './notification-store';
import * as shared from './supabase-notifications';

function getNotificationsKv(): NotificationKv | null {
  try {
    const context = getCloudflareContext();
    return (context.env as { NOTIFICATIONS_KV?: NotificationKv }).NOTIFICATIONS_KV || null;
  } catch {
    return null;
  }
}

const CHANNEL_PREFIX = 'notify:dept:';

export async function notifyDepartment(
  departmentId: string,
  message: Notification
) {
  if (process.env.SHARED_NOTIFICATIONS_DB === 'true') return shared.notifyDepartment(departmentId, message);
  const kv = getNotificationsKv();
  if (!kv) return;

  try {
    // KV ไม่รองรับ read-modify-write แบบ atomic และจำกัดการเขียน key เดิมต่อวินาที
    // แยกหนึ่ง key ต่อข้อความ ป้องกันการแจ้งเตือนเป็นชุดเขียนทับกันข้าม instance
    const newestFirst = String(9_999_999_999_999 - Date.now()).padStart(13, '0');
    const key = `${CHANNEL_PREFIX}${departmentId}:${newestFirst}:${randomUUID()}`;
    await kv.put(key, JSON.stringify(message), { expirationTtl: 86400 });
  } catch (error) {
    console.error('[Cloudflare KV] Notification error:', error);
  }
}

export async function getNotifications(departmentId: string) {
  if (process.env.SHARED_NOTIFICATIONS_DB === 'true') return shared.getNotifications(departmentId);
  return readNotifications(getNotificationsKv(), departmentId);
}

export async function clearNotifications(departmentId: string) {
  if (process.env.SHARED_NOTIFICATIONS_DB === 'true') return shared.clearNotifications(departmentId);
  return removeNotifications(getNotificationsKv(), departmentId);
}
