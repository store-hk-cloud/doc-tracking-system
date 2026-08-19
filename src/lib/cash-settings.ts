import { getServiceSupabase } from '@/lib/supabase/admin';

/**
 * รหัสแผนกที่มีอำนาจเรื่องเงิน อ่านจากตาราง app_settings ไม่ hardcode
 *
 * ทำไม: หน่วยงานจริงใช้รหัสแบบ 0-ADM03 / 0-BSN06 ซึ่งเปลี่ยนได้ตามการจัดองค์กร
 * ถ้าฝัง 'FIN' ไว้ในโค้ดและ trigger เมื่อองค์กรปรับโครงสร้างจะกลายเป็นว่า
 * ไม่มีใครอนุมัติเงินได้เลย และต้อง deploy ใหม่ทุกครั้ง
 *
 * trigger `assert_variance_approver` ใน DB อ่านค่าชุดเดียวกันนี้ (migration 009)
 * ดังนั้นการแก้ค่าที่ app_settings จึงมีผลกับทั้งสองชั้นพร้อมกัน ไม่หลุดจากกัน
 */

const DEFAULTS = {
  cash_approver_dept_codes: '0-ADM03',
  cash_shortage_dept_codes: '0-ADM03,0-ADM03-1',
  cash_viewer_dept_codes: '0-ADM03,0-ADM03-1,0-SDM01',
  messenger_dept_codes: 'MSG',
} as const;

export type CashSettingKey = keyof typeof DEFAULTS;

export type CashDeptCodes = Record<CashSettingKey, string[]>;

// cache ระดับ module: ค่าพวกนี้เปลี่ยนน้อยมาก และทุก request ที่แตะเงินต้องใช้
// ตั้ง TTL สั้นเพื่อให้แก้ค่าแล้วเห็นผลภายในไม่กี่นาทีโดยไม่ต้อง redeploy
const TTL_MS = 60_000;
let cache: { at: number; value: CashDeptCodes } | null = null;

function parse(value: string | null | undefined, fallback: string): string[] {
  const raw = (value ?? '').trim() || fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function getCashDeptCodes(): Promise<CashDeptCodes> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  const keys = Object.keys(DEFAULTS) as CashSettingKey[];
  const { data } = await getServiceSupabase()
    .from('app_settings')
    .select('key, value')
    .in('key', keys);

  const map = new Map((data || []).map((r: any) => [r.key, r.value]));
  const value = Object.fromEntries(
    keys.map((k) => [k, parse(map.get(k), DEFAULTS[k])])
  ) as CashDeptCodes;

  cache = { at: Date.now(), value };
  return value;
}

/** ใช้ในเทส/หลังแก้ค่าตั้ง เพื่อให้อ่านค่าใหม่ทันที */
export function clearCashSettingsCache() {
  cache = null;
}
