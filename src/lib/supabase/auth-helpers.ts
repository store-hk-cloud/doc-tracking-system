import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import type { UserRole } from '@/types';

export type AuthContext = {
  user: { id: string; email?: string };
  profile: {
    id: string;
    role: UserRole;
    department_id: string | null;
    /**
     * departments.code (เช่น 'FIN', 'MSG') join มาในคิวรีเดียวกับ profile
     * โมดูลเงินสดตัดสินสิทธิ์จากค่านี้ ไม่ใช่จาก role เพราะ role ถูก pin ด้วย
     * CHECK constraint ไว้ที่ super_admin|admin|user และจะไม่ขยายเพิ่ม
     */
    department_code: string | null;
    is_active: boolean;
  };
};

export async function getAuthContext(): Promise<AuthContext | null> {
  const authClient = await createServerSupabase();
  const { data: { user }, error: userError } = await authClient.auth.getUser();
  if (userError || !user) return null;

  // embed departments(code) ไว้ในคิวรีเดิม — ยัง 1 round-trip เพราะ PostgREST
  // join ให้ในคิวรีเดียว และเป็นการเพิ่ม field ไม่ทำให้ caller เดิมพัง
  const { data: profileData, error: profileError } = await getServiceSupabase()
    .from('profiles')
    .select('id, role, department_id, is_active, departments(code)')
    .eq('id', user.id)
    .single();

  const raw = profileData as any;
  if (profileError || !raw || raw.is_active === false) return null;

  // flatten ให้ caller ไม่ต้องรู้เรื่อง nested embed
  const profile: AuthContext['profile'] = {
    id: raw.id,
    role: raw.role,
    department_id: raw.department_id,
    department_code: raw.departments?.code ?? null,
    is_active: raw.is_active,
  };

  return {
    user: { id: user.id, email: user.email },
    profile,
  };
}

export function unauthorizedResponse() {
  return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
}

export function forbiddenResponse() {
  return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
}

export async function requireRoles(roles: UserRole[]) {
  const context = await getAuthContext();
  if (!context) return { context: null, response: unauthorizedResponse() };
  if (!roles.includes(context.profile.role)) {
    return { context, response: forbiddenResponse() };
  }
  return { context, response: null };
}

export function canAccessDepartment(context: AuthContext, departmentId: string | null | undefined) {
  return context.profile.department_id === departmentId;
}

/**
 * เหมือน requireRoles แต่เช็ค department code ด้วย ใช้กับโมดูลเงินสดซึ่งแยก
 * สิทธิ์ตามแผนก ไม่ใช่ตาม role (role enum ขยายไม่ได้)
 *
 * - roles ว่าง/ไม่ส่ง = ยอมรับทุก role ที่ล็อกอิน
 * - deptCodes ไม่ส่ง = ไม่เช็คแผนก
 * - super_admin ผ่าน deptCodes ได้เสมอ (ต้องดูได้ทุกอย่าง) แต่ admin ทั่วไปไม่ได้
 *   เช่น admin ของ HR ไม่ควรเข้าถึงข้อมูลเงินสด
 */
export async function requireCapability(opts: {
  roles?: UserRole[];
  deptCodes?: string[];
}) {
  const context = await getAuthContext();
  if (!context) return { context: null, response: unauthorizedResponse() };

  const { role, department_code } = context.profile;

  if (opts.roles && opts.roles.length > 0 && !opts.roles.includes(role)) {
    return { context, response: forbiddenResponse() };
  }
  if (opts.deptCodes && opts.deptCodes.length > 0 && role !== 'super_admin') {
    if (!department_code || !opts.deptCodes.includes(department_code)) {
      return { context, response: forbiddenResponse() };
    }
  }
  return { context, response: null };
}
