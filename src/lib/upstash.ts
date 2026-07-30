import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '',
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '',
});

const CHANNEL_PREFIX = 'notify:dept:';

export async function notifyDepartment(
  departmentId: string,
  message: { title: string; body: string; docId: string; runningNo: number }
) {
  try {
    const key = `${CHANNEL_PREFIX}${departmentId}`;
    await redis.lpush(key, JSON.stringify(message));
    await redis.ltrim(key, 0, 99); // Keep last 100
    await redis.expire(key, 86400); // 24 hours TTL
  } catch (error) {
    console.error('[Upstash] Notification error:', error);
  }
}

export async function getNotifications(departmentId: string) {
  try {
    const key = `${CHANNEL_PREFIX}${departmentId}`;
    const data = await redis.lrange(key, 0, 49);
    return data.map((item) => JSON.parse(item as string));
  } catch {
    return [];
  }
}

export async function clearNotifications(departmentId: string) {
  try {
    const key = `${CHANNEL_PREFIX}${departmentId}`;
    await redis.del(key);
  } catch (error) {
    console.error('[Upstash] Clear error:', error);
  }
}