import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { updateRow, findRowByValue } from '@/lib/google-sheets';
import { requireRoles } from '@/lib/supabase/auth-helpers';

// Resets a rejected document back to 'delivered' so the recipient can sign again.
export async function PUT(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRoles(['super_admin', 'admin']);
    if (auth.response) return auth.response;

    const { id } = await params;
    const supabase = getServiceSupabase();

    const { data, error } = await supabase
      .from('documents')
      .update({ status: 'delivered' })
      .eq('id', id)
      .eq('status', 'rejected')
      .select('*')
      .single();

    if (error || !data) {
      return NextResponse.json(
        { success: false, error: 'Only rejected documents can be redelivered' },
        { status: 409 }
      );
    }

    let deptName = '';
    if (data.recipient_dept_id) {
      const { data: dept } = await supabase.from('departments').select('name').eq('id', data.recipient_dept_id).single();
      deptName = dept?.name || '';
    }
    let profName = '';
    if (data.recorded_by) {
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', data.recorded_by).single();
      profName = prof?.full_name || '';
    }

    const row = await findRowByValue('เอกสารเข้า', 1, String(data.running_no));
    if (row) {
      await updateRow('เอกสารเข้า', row, [
        String(data.running_no), data.received_date, data.doc_number || '',
        data.sender, data.subject, deptName,
        'delivered', data.admin_signature || '', data.admin_signed_at || '',
        '', '', data.is_damaged ? 'ใช่' : 'ไม่',
        data.damage_image_url || '', data.note || '',
        profName, data.created_at, data.updated_at,
      ]);
    }

    return NextResponse.json({ success: true, data: { ...data, recipient_dept_name: deptName, recorded_by_name: profName } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
