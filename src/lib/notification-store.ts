export type Notification = { title: string; body: string; docId: string; runningNo: number };
export type NotificationKv = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; limit?: number; cursor?: string }): Promise<{
    keys: { name: string }[]; list_complete: boolean; cursor?: string;
  }>;
};

const CHANNEL_PREFIX = 'notify:dept:';

export async function readNotifications(kv: NotificationKv | null | undefined, departmentId: string) {
  if (!kv) return [];

  try {
    const prefix = `${CHANNEL_PREFIX}${departmentId}:`;
    const messages: Notification[] = [];
    let cursor: string | undefined;
    do {
      const page = await kv.list({ prefix, limit: 50 - messages.length, cursor });
      const values = await Promise.all(page.keys.map(({ name }) => kv.get(name)));
      for (const value of values) if (value) messages.push(JSON.parse(value));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor && messages.length < 50);
    // อ่านรายการที่เขียนด้วยรูปแบบก่อนย้ายระบบจนกว่าจะหมดอายุเอง
    if (messages.length < 50) {
      const legacy = await kv.get(`${CHANNEL_PREFIX}${departmentId}`);
      if (legacy) messages.push(...JSON.parse(legacy));
    }
    return messages.slice(0, 50);
  } catch {
    return [];
  }
}

export async function removeNotifications(kv: NotificationKv | null | undefined, departmentId: string) {
  if (!kv) return;

  try {
    const prefix = `${CHANNEL_PREFIX}${departmentId}:`;
    const names: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await kv.list({ prefix, cursor });
      names.push(...page.keys.map(({ name }) => name));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    await Promise.all(names.map((name) => kv.delete(name)));
    await kv.delete(`${CHANNEL_PREFIX}${departmentId}`);
  } catch (error) {
    console.error('[Cloudflare KV] Clear error:', error);
  }
}
