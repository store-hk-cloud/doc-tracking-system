import type { Profile, UserRole } from '@/types';

/**
 * แหล่งความจริงเดียวของเมนู — ทั้ง Sidebar (desktop) และ AppLayout (mobile)
 * import จากที่นี่
 *
 * ทำไมต้องรวม: ก่อนหน้านี้ทั้งสองไฟล์ประกาศเมนูแยกกันและ **ขัดกันจริง** —
 * Sidebar ให้ /register และ /delivery กับ role user แต่ AppLayout ให้แค่ admin
 * ผลคือ user เห็นเมนูบน desktop แต่ไม่เห็นบนมือถือ และเข้าได้ทั้งคู่เพราะ
 * ไม่มี gate ที่หน้าเพจ พอเพิ่มเมนูที่แยกตามแผนก (เงินสด) ความคลาดเคลื่อน
 * แบบนี้จะกลายเป็นช่องสิทธิ์ ไม่ใช่แค่ความไม่สวยงาม
 */

export type NavItem = {
  path: string;
  /** ป้ายเต็ม (ไทย) ใช้ใน sidebar */
  label: string;
  /** ป้ายสั้น ≤7 ตัวอักษร ใช้ใน bottom nav (0.68rem บรรทัดเดียว) */
  shortLabel: string;
  icon: string;
  roles: UserRole[];
  /**
   * ต้องมีสิทธิ์ตัวนี้ใน profile.capabilities ถึงจะเห็นเมนู
   *
   * ห้ามกลับไปใช้รายการรหัสแผนกตรง ๆ ที่นี่: รหัสแผนกผู้ดู/ผู้อนุมัติเงินสด
   * เก็บอยู่ใน app_settings และแก้ได้โดยไม่ deploy ถ้า nav ถือสำเนาของตัวเอง
   * มันจะเพี้ยนจาก server เงียบ ๆ (เคยเกิดมาแล้ว: nav ค้างอยู่ที่รหัสสมมติ
   * FIN/ACC หลังย้ายไปใช้รหัสจริง 0-ADM03 ทำให้ผู้อนุมัติตัวจริงไม่เห็นเมนู
   * ทั้งที่ API ยอมให้เข้า) capabilities มาจาก server ที่อ่าน app_settings ชุดเดียวกัน
   */
  capability?: 'isMessenger' | 'canViewCash';
  /** 1-4 = ได้ช่องจริงบนแถบล่าง ไม่ใส่ = ไปอยู่ในเมนู "เพิ่มเติม" */
  mobilePriority?: number;
};

const ALL_ROLES: UserRole[] = ['super_admin', 'admin', 'user'];

export const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard', label: '📊 Dashboard', shortLabel: 'Home', icon: 'Home', roles: ALL_ROLES, mobilePriority: 1 },

  // โมดูลเงินสด — แยกตามแผนก ไม่ใช่ตาม role
  {
    path: '/messenger',
    label: '🏍 งานฝากเงินของฉัน',
    shortLabel: 'งานเงิน',
    icon: 'Cash',
    roles: ALL_ROLES,
    capability: 'isMessenger',
    mobilePriority: 2,
  },
  {
    path: '/finance',
    label: '💵 เงินสด/ฝากธนาคาร',
    shortLabel: 'เงินสด',
    icon: 'Bank',
    roles: ALL_ROLES,
    capability: 'canViewCash',
    mobilePriority: 2,
  },
  {
    path: '/finance/variances',
    label: '🚨 ตรวจยอดขาด/เกิน',
    shortLabel: 'ตรวจยอด',
    icon: 'Alert',
    roles: ALL_ROLES,
    capability: 'canViewCash',
    mobilePriority: 3,
  },

  // โมดูลเอกสารเดิม
  { path: '/register', label: '📝 ลงทะเบียน', shortLabel: 'ลงทะ.', icon: 'Add', roles: ['super_admin', 'admin'], mobilePriority: 3 },
  { path: '/delivery', label: '📦 ส่งมอบ', shortLabel: 'ส่งมอบ', icon: 'Send', roles: ['super_admin', 'admin'], mobilePriority: 4 },
  { path: '/recipient', label: '✍️ รับเอกสาร', shortLabel: 'รับ', icon: 'Sign', roles: ALL_ROLES, mobilePriority: 4 },
  { path: '/tracking', label: '🔍 ติดตาม', shortLabel: 'ติดตาม', icon: 'Find', roles: ALL_ROLES },
  { path: '/reports', label: '📈 รายงาน', shortLabel: 'รายงาน', icon: 'Stats', roles: ALL_ROLES },
  { path: '/policies', label: '📚 นโยบายและคู่มือ', shortLabel: 'คู่มือ', icon: 'Book', roles: ALL_ROLES },
  { path: '/admin/users', label: '👥 จัดการผู้ใช้', shortLabel: 'ผู้ใช้', icon: 'Users', roles: ['super_admin', 'admin'] },
  { path: '/admin/departments', label: '🏢 จัดการหน่วยงาน', shortLabel: 'หน่วยงาน', icon: 'Org', roles: ['super_admin'] },
];

/**
 * กรองเมนูตามสิทธิ์
 *
 * เมนูเงินสดกรองด้วย capabilities ที่ server คำนวณมาจาก app_settings
 * (super_admin ได้ค่า true มาจาก server อยู่แล้ว จึงไม่ต้องยกเว้นซ้ำที่นี่)
 * ส่วน role ยังกรองที่ client ได้ เพราะเป็นค่าคงที่ในโค้ด ไม่ใช่ค่าตั้งที่แก้ได้
 */
export function visibleNavItems(profile: Profile | null | undefined): NavItem[] {
  const role: UserRole = profile?.role || 'user';
  return NAV_ITEMS.filter((item) => {
    if (!item.roles.includes(role)) return false;
    if (item.capability && profile?.capabilities?.[item.capability] !== true) return false;
    return true;
  });
}

/**
 * แถบล่างมี 5 ช่อง: 4 ช่องจริง + 1 ช่อง "เพิ่มเติม"
 * ก่อนหน้านี้โค้ดใช้ .slice(0, 5) ซึ่งตัดเมนูท้ายทิ้งเงียบ ๆ (admin เสีย "รายงาน"
 * ไปโดยไม่มีทางเข้าถึงบนมือถือ) — ที่นี่จึงคืนทั้งสองส่วนให้ caller แสดงครบ
 */
export function splitMobileNav(profile: Profile | null | undefined): {
  primary: NavItem[];
  overflow: NavItem[];
} {
  const visible = visibleNavItems(profile);
  const primary = visible
    .filter((i) => i.mobilePriority !== undefined)
    .sort((a, b) => (a.mobilePriority! - b.mobilePriority!))
    .slice(0, 4);
  const primaryPaths = new Set(primary.map((i) => i.path));
  const overflow = visible.filter((i) => !primaryPaths.has(i.path));
  return { primary, overflow };
}

/**
 * เมนูไหน active — ต้องเทียบแบบ exact หรือ prefix ที่มี "/" คั่น
 * ใช้ pathname.startsWith(path) เฉย ๆ ไม่ได้ เพราะ /finance จะ active ตอนอยู่
 * /finance/variances ด้วย (และ /finance/variances เป็น prefix ของกันเอง)
 */
export function isNavItemActive(item: NavItem, pathname: string, allItems: NavItem[] = NAV_ITEMS): boolean {
  if (pathname === item.path) return true;
  if (!pathname.startsWith(`${item.path}/`)) return false;
  // ถ้ามีเมนูอื่นที่ path ยาวกว่าและตรงกับ pathname นี้มากกว่า ให้เมนูนั้น active แทน
  const moreSpecific = allItems.some(
    (other) =>
      other.path !== item.path &&
      other.path.startsWith(`${item.path}/`) &&
      (pathname === other.path || pathname.startsWith(`${other.path}/`))
  );
  return !moreSpecific;
}
