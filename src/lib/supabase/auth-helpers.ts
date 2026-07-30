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
    is_active: boolean;
  };
};

export async function getAuthContext(): Promise<AuthContext | null> {
  const authClient = await createServerSupabase();
  const { data: { user }, error: userError } = await authClient.auth.getUser();
  if (userError || !user) return null;

  const { data: profileData, error: profileError } = await getServiceSupabase()
    .from('profiles')
    .select('id, role, department_id, is_active')
    .eq('id', user.id)
    .single();
  const profile = profileData as AuthContext['profile'] | null;

  if (profileError || !profile || profile.is_active === false) return null;

  return {
    user: { id: user.id, email: user.email },
    profile: profile as AuthContext['profile'],
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
  return context.profile.role !== 'user' || context.profile.department_id === departmentId;
}
