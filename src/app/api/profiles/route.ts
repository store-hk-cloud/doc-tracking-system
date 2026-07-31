import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { requireRoles } from '@/lib/supabase/auth-helpers';

export async function GET() {
  try {
    const auth = await requireRoles(['super_admin', 'admin']);
    if (auth.response) return auth.response;

    const supabase = getServiceSupabase();

    // Fetch profiles and departments separately to avoid 500 from join RLS issues
    let query = supabase.from('profiles').select('*').order('full_name');
    // Admins can only see plain 'user' accounts — never other admins/super_admins.
    if (auth.context!.profile.role === 'admin') {
      query = query.eq('role', 'user');
    }
    const [{ data: profiles, error: profilesError }, { data: departments }] = await Promise.all([
      query,
      supabase.from('departments').select('id, name'),
    ]);

    if (profilesError) throw profilesError;

    const deptMap = new Map((departments || []).map((d: any) => [d.id, d.name]));
    const mapped = (profiles || []).map((p: any) => ({
      ...p,
      department_name: deptMap.get(p.department_id) || null,
    }));

    return NextResponse.json({ success: true, data: mapped });
  } catch (error: any) {
    console.error('[Profiles] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRoles(['super_admin', 'admin']);
    if (auth.response) return auth.response;

    const supabase = getServiceSupabase();
    const body = await request.json();

    if (!body.email || !body.password || !body.full_name) {
      return NextResponse.json({ success: false, error: 'email, password and full_name are required' }, { status: 400 });
    }

    // Admins can only ever create plain 'user' accounts — never admin/super_admin.
    let role: string = 'user';
    if (auth.context!.profile.role === 'super_admin') {
      const allowedRoles = new Set(['user', 'admin', 'super_admin']);
      role = allowedRoles.has(body.role) ? body.role : 'user';
    }

    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
    });
    if (authError) throw authError;

    // Create profile
    const { data, error } = await supabase
      .from('profiles')
      .insert({
        id: authData.user.id,
        email: body.email,
        full_name: body.full_name,
        role,
        department_id: body.department_id || null,
      })
      .select()
      .single();

    if (error) throw error;

    // Get department name
    let department_name = null;
    if (data.department_id) {
      const { data: dept } = await supabase
        .from('departments')
        .select('name')
        .eq('id', data.department_id)
        .single();
      department_name = dept?.name || null;
    }

    return NextResponse.json({
      success: true,
      data: { ...data, department_name },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
