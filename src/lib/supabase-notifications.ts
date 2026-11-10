import { getServiceSupabase } from './supabase/admin';
import type { Notification } from './notification-store';

export async function notifyDepartment(departmentId: string, message: Notification) {
  const { error } = await getServiceSupabase().rpc('write_department_notification', {
    p_department_id: departmentId, p_message: message,
  });
  if (error) console.error('[Supabase] Notification write failed:', error.code);
}

async function accessDepartment(departmentId: string, clear: boolean): Promise<Notification[]> {
  const { data, error } = await getServiceSupabase().rpc('access_department_notifications', {
    p_department_id: departmentId, p_clear: clear,
  });
  if (error) console.error('[Supabase] Notification access failed:', error.code);
  return Array.isArray(data) ? data : [];
}

export function getNotifications(departmentId: string) {
  return accessDepartment(departmentId, false);
}

export async function clearNotifications(departmentId: string) {
  await accessDepartment(departmentId, true);
}
