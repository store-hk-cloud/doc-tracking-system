import type { Profile } from '@/types';

/**
 * สิทธิ์ของโมดูลเงินสดฝั่ง client
 *
 * ค่าทั้งหมด **คำนวณที่ server** แล้วส่งมากับ /api/profile (ฟิลด์ `capabilities`)
 * ไฟล์นี้จึงเป็นแค่ตัวอ่านค่า ไม่มีตรรกะรหัสแผนกซ้ำ — สำคัญเพราะรหัสแผนก
 * ผู้อนุมัติเก็บอยู่ใน app_settings และเปลี่ยนได้ ถ้า client คำนวณเองจะเพี้ยน
 * จาก server ทันทีที่มีการแก้ค่าตั้ง
 *
 * *** นี่เป็นแค่ UX ไม่ใช่ security ***
 * src/middleware.ts เช็คแค่ว่ามี user ล็อกอิน ไม่เช็ค role/dept เลย
 * ทุก API route จึง gate ซ้ำด้วย requireCapability + permissions.ts ฝั่ง server เสมอ
 */

type P = Profile | null | undefined;

const read = (profile: P, key: keyof NonNullable<Profile['capabilities']>): boolean =>
  profile?.capabilities?.[key] === true;

export function isMessenger(profile: P): boolean {
  return read(profile, 'isMessenger');
}

export function canViewCash(profile: P): boolean {
  return read(profile, 'canViewCash');
}

export function canCloseShortage(profile: P): boolean {
  return read(profile, 'canCloseShortage');
}

/** เข้มที่สุด: ธุรการในแผนกผู้อนุมัติ หรือผู้ดูแลระบบ เท่านั้น */
export function canApproveOverage(profile: P): boolean {
  return read(profile, 'canApproveOverage');
}

/** เข้าถึง segment /messenger ได้ */
export function canAccessMessengerArea(profile: P): boolean {
  return isMessenger(profile) || profile?.role === 'super_admin';
}

/** เข้าถึง segment /finance ได้ */
export function canAccessFinanceArea(profile: P): boolean {
  return canViewCash(profile);
}
