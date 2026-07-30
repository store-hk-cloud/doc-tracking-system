import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { requireRoles } from '@/lib/supabase/auth-helpers';

export async function GET() {
  try {
    const auth = await requireRoles(['super_admin', 'admin', 'user']);
    if (auth.response) return auth.response;

    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from('departments')
      .select('*')
      .order('name');
    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRoles(['super_admin']);
    if (auth.response) return auth.response;

    const supabase = getServiceSupabase();
    const body = await request.json();
    if (!body.name || !body.code) {
      return NextResponse.json({ success: false, error: 'name and code are required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('departments')
      .insert({ name: body.name, code: body.code })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireRoles(['super_admin']);
    if (auth.response) return auth.response;

    const supabase = getServiceSupabase();
    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ success: false, error: 'No ID provided' }, { status: 400 });
    }

    const [{ count: docCount }, { count: profileCount }] = await Promise.all([
      supabase.from('documents').select('id', { count: 'exact', head: true }).eq('recipient_dept_id', id),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('department_id', id),
    ]);
    if ((docCount || 0) > 0 || (profileCount || 0) > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `ลบไม่ได้ เนื่องจากยังมีเอกสาร ${docCount || 0} รายการ และผู้ใช้ ${profileCount || 0} คน ผูกอยู่กับหน่วยงานนี้`,
        },
        { status: 409 }
      );
    }

    const { error } = await supabase.from('departments').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
