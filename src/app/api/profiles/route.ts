import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from('profiles')
      .select('*, departments(name)')
      .order('full_name');
    if (error) throw error;
    const mapped = data.map((p: any) => ({
      ...p,
      department_name: p.departments?.name,
    }));
    return NextResponse.json({ success: true, data: mapped });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
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
      .select('*, departments(name)')
      .single();

    if (error) throw error;

    return NextResponse.json({
      success: true,
      data: { ...data, department_name: data.departments?.name },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}