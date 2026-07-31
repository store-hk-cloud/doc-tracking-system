import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { requireRoles } from '@/lib/supabase/auth-helpers';

const ALLOWED_ROLES = new Set(['user', 'admin', 'super_admin']);

async function remainingSuperAdminCount(supabase: ReturnType<typeof getServiceSupabase>, excludingId?: string) {
  let query = supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'super_admin').eq('is_active', true);
  if (excludingId) query = query.neq('id', excludingId);
  const { count } = await query;
  return count || 0;
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRoles(['super_admin', 'admin']);
    if (auth.response) return auth.response;

    const { id } = await params;
    const supabase = getServiceSupabase();
    const body = await request.json();
    const isSelf = id === auth.context!.user.id;

    const { data: target, error: targetError } = await supabase
      .from('profiles')
      .select('id, role, is_active')
      .eq('id', id)
      .single();
    if (targetError || !target) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const updates: Record<string, any> = {};
    if (typeof body.full_name === 'string') updates.full_name = body.full_name;
    if ('department_id' in body) updates.department_id = body.department_id || null;

    if (auth.context!.profile.role === 'admin') {
      // Admins may only touch plain 'user' accounts, and can never change the role field.
      if (target.role !== 'user') {
        return NextResponse.json({ success: false, error: 'Admins can only manage plain user accounts' }, { status: 403 });
      }
      if ('role' in body && body.role !== 'user') {
        return NextResponse.json({ success: false, error: 'Admins cannot grant admin/super_admin roles' }, { status: 403 });
      }
      if ('is_active' in body) updates.is_active = body.is_active === true;
    } else {
      // super_admin
      if (isSelf && (('role' in body && body.role !== target.role) || body.is_active === false)) {
        return NextResponse.json({ success: false, error: 'You cannot change your own role or deactivate yourself' }, { status: 403 });
      }
      if ('role' in body) {
        if (!ALLOWED_ROLES.has(body.role)) {
          return NextResponse.json({ success: false, error: 'Invalid role' }, { status: 400 });
        }
        if (target.role === 'super_admin' && body.role !== 'super_admin') {
          const remaining = await remainingSuperAdminCount(supabase, id);
          if (remaining === 0) {
            return NextResponse.json({ success: false, error: 'Cannot demote the last super_admin' }, { status: 409 });
          }
        }
        updates.role = body.role;
      }
      if ('is_active' in body) {
        const nextActive = body.is_active === true;
        if (!nextActive && target.role === 'super_admin') {
          const remaining = await remainingSuperAdminCount(supabase, id);
          if (remaining === 0) {
            return NextResponse.json({ success: false, error: 'Cannot deactivate the last super_admin' }, { status: 409 });
          }
        }
        updates.is_active = nextActive;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: false, error: 'No editable fields provided' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    let department_name = null;
    if (data.department_id) {
      const { data: dept } = await supabase.from('departments').select('name').eq('id', data.department_id).single();
      department_name = dept?.name || null;
    }

    return NextResponse.json({ success: true, data: { ...data, department_name } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRoles(['super_admin', 'admin']);
    if (auth.response) return auth.response;

    const { id } = await params;
    if (id === auth.context!.user.id) {
      return NextResponse.json({ success: false, error: 'You cannot delete your own account' }, { status: 403 });
    }

    const supabase = getServiceSupabase();
    const { data: target, error: targetError } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('id', id)
      .single();
    if (targetError || !target) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    if (auth.context!.profile.role === 'admin' && target.role !== 'user') {
      return NextResponse.json({ success: false, error: 'Admins can only manage plain user accounts' }, { status: 403 });
    }

    if (target.role === 'super_admin') {
      const remaining = await remainingSuperAdminCount(supabase, id);
      if (remaining === 0) {
        return NextResponse.json({ success: false, error: 'Cannot delete the last super_admin' }, { status: 409 });
      }
    }

    const [{ count: docCount }, { count: deliveryCount }] = await Promise.all([
      supabase.from('documents').select('id', { count: 'exact', head: true }).eq('recorded_by', id),
      supabase.from('delivery_logs').select('id', { count: 'exact', head: true }).eq('recipient_id', id),
    ]);
    if ((docCount || 0) > 0 || (deliveryCount || 0) > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `ลบไม่ได้ เนื่องจากผู้ใช้นี้มีประวัติการใช้งาน (เอกสาร ${docCount || 0} รายการ, การรับเอกสาร ${deliveryCount || 0} รายการ) กรุณาระงับการใช้งานแทนการลบ`,
        },
        { status: 409 }
      );
    }

    const { error: deleteError } = await supabase.auth.admin.deleteUser(id);
    if (deleteError) throw deleteError;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
