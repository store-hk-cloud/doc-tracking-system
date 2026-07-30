import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { getAuthContext, unauthorizedResponse } from '@/lib/supabase/auth-helpers';

export async function GET() {
  try {
    const context = await getAuthContext();
    if (!context) return unauthorizedResponse();

    const supabase = getServiceSupabase();

    // Fetch profile and department in parallel
    const [{ data: profile }, { data: depts }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', context.user.id).single(),
      supabase.from('departments').select('id, name'),
    ]);

    if (!profile) {
      return NextResponse.json({ success: false, error: 'Profile not found' }, { status: 404 });
    }

    const deptMap = new Map((depts || []).map((d: any) => [d.id, d.name]));
    const department_name = profile.department_id ? deptMap.get(profile.department_id) : undefined;

    return NextResponse.json({
      success: true,
      data: { ...profile, department_name },
    });
  } catch (error: any) {
    console.error('[Profile API] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
