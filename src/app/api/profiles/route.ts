import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';

export async function GET() {
  try {
    const supabase = getServiceSupabase();
    
    // Fetch profiles and departments separately to avoid 500 from join RLS issues
    const [{ data: profiles, error: profilesError }, { data: departments }] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
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
    const supabase = getServiceSupabase();
    const body = await request.json();

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
        role: body.role || 'user',
        department_id: body.department_id,
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