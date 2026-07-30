import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { updateRow, findRowByValue } from '@/lib/google-sheets';
import { canAccessDepartment, forbiddenResponse, requireRoles } from '@/lib/supabase/auth-helpers';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRoles(['super_admin', 'admin', 'user']);
    if (auth.response) return auth.response;

    const { id } = await params;
    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    if (!canAccessDepartment(auth.context!, data.recipient_dept_id)) return forbiddenResponse();

    // Get department and profile names separately
    let recipient_dept_name = null;
    let recorded_by_name = null;
    if (data.recipient_dept_id) {
      const { data: dept } = await supabase.from('departments').select('name').eq('id', data.recipient_dept_id).single();
      recipient_dept_name = dept?.name || null;
    }
    if (data.recorded_by) {
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', data.recorded_by).single();
      recorded_by_name = prof?.full_name || null;
    }

    return NextResponse.json({
      success: true,
      data: { ...data, recipient_dept_name, recorded_by_name },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRoles(['super_admin', 'admin']);
    if (auth.response) return auth.response;

    const { id } = await params;
    const supabase = getServiceSupabase();
    const body = await request.json();

    const { data: existing, error: existingError } = await supabase
      .from('documents')
      .select('status')
      .eq('id', id)
      .single();
    if (existingError || !existing) {
      return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 });
    }

    const allowedFields = [
      'received_date', 'doc_number', 'sender', 'subject',
      'recipient_dept_id', 'note', 'is_damaged', 'damage_image_url',
    ] as const;
    if (Object.prototype.hasOwnProperty.call(body, 'recipient_dept_id') && existing.status !== 'registered') {
      return NextResponse.json(
        { success: false, error: 'recipient_dept_id can only be changed while the document is still registered' },
        { status: 409 }
      );
    }
    const updates = Object.fromEntries(
      allowedFields
        .filter((field) => Object.prototype.hasOwnProperty.call(body, field))
        .map((field) => [field, body[field]])
    );
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: false, error: 'No editable fields provided' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('documents')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    // Get department name
    let deptName = '';
    if (data.recipient_dept_id) {
      const { data: dept } = await supabase.from('departments').select('name').eq('id', data.recipient_dept_id).single();
      deptName = dept?.name || '';
    }

    // Get profile name
    let profName = '';
    if (data.recorded_by) {
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', data.recorded_by).single();
      profName = prof?.full_name || '';
    }

    // Sync to Sheets
    const row = await findRowByValue('เอกสารเข้า', 1, String(data.running_no));
    if (row) {
      updateRow('เอกสารเข้า', row, [
        String(data.running_no), data.received_date, data.doc_number || '',
        data.sender, data.subject, deptName,
        data.status, data.admin_signature || '', data.admin_signed_at || '',
        '', '', data.is_damaged ? 'ใช่' : 'ไม่',
        data.damage_image_url || '', data.note || '',
        profName, data.created_at, data.updated_at,
      ]);
    }

    return NextResponse.json({
      success: true,
      data: { ...data, recipient_dept_name: deptName },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRoles(['super_admin']);
    if (auth.response) return auth.response;

    const { id } = await params;
    const supabase = getServiceSupabase();
    const { error } = await supabase.from('documents').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
