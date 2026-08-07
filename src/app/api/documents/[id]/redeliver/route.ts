import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { updateRow, findRowByValue } from '@/lib/google-sheets';
import { requireRoles } from '@/lib/supabase/auth-helpers';

// [id] here is a document_recipients.id. Resets a rejected department copy
// back to 'delivered' so that department's recipient can sign again.
export async function PUT(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRoles(['super_admin', 'admin']);
    if (auth.response) return auth.response;

    const { id } = await params;
    const supabase = getServiceSupabase();

    const { data: recipient, error } = await supabase
      .from('document_recipients')
      .update({ status: 'delivered' })
      .eq('id', id)
      .eq('status', 'rejected')
      .select('*')
      .single();

    if (error || !recipient) {
      return NextResponse.json(
        { success: false, error: 'Only rejected documents can be redelivered' },
        { status: 409 }
      );
    }

    const { data } = await supabase.from('documents').select('*').eq('id', recipient.document_id).single();
    if (!data) throw new Error('Parent document not found');

    let deptName = '';
    const { data: dept } = await supabase.from('departments').select('name').eq('id', recipient.department_id).single();
    deptName = dept?.name || '';

    let profName = '';
    if (data.recorded_by) {
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', data.recorded_by).single();
      profName = prof?.full_name || '';
    }

    const row = await findRowByValue('เอกสารเข้า', 21, recipient.id);
    if (row) {
      await updateRow('เอกสารเข้า', row, [
        String(data.running_no), data.received_date, data.doc_number || '',
        data.sender, data.subject, deptName,
        'delivered', recipient.admin_signature || '', recipient.admin_signed_at || '',
        '', '', '', '', '',
        data.is_damaged ? 'ใช่' : 'ไม่', data.damage_image_url || '', data.note || '',
        profName, recipient.updated_at, data.tax_invoice_no || '', recipient.id,
      ]);
    }

    return NextResponse.json({
      success: true,
      data: { ...data, ...recipient, id: recipient.id, document_id: data.id, recipient_dept_id: recipient.department_id, recipient_dept_name: deptName, recorded_by_name: profName },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
