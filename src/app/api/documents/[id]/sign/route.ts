import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { updateRow, findRowByValue } from '@/lib/google-sheets';
import { notifyDepartment } from '@/lib/upstash';
import { forbiddenResponse, requireRoles } from '@/lib/supabase/auth-helpers';

// [id] here is a document_recipients.id — delivery is scoped to one
// department's copy of a document, not the whole document.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRoles(['super_admin', 'admin', 'user']);
    if (auth.response) return auth.response;

    const { id } = await params;
    const supabase = getServiceSupabase();
    const body = await request.json();

    if (!body.admin_signature) {
      return NextResponse.json({ success: false, error: 'admin_signature is required' }, { status: 400 });
    }

    const { data: existingRecipient, error: existingError } = await supabase
      .from('document_recipients')
      .select('status, department_id, document_id')
      .eq('id', id)
      .single();
    if (existingError || !existingRecipient) {
      return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 });
    }
    // Only 'user' is restricted to their own department here; admin/super_admin
    // may still deliver to any department (unchanged from before this feature).
    if (auth.context!.profile.role === 'user' && auth.context!.profile.department_id !== existingRecipient.department_id) {
      return forbiddenResponse();
    }
    if (existingRecipient.status !== 'registered') {
      return NextResponse.json({ success: false, error: 'Only registered documents can be signed for delivery' }, { status: 409 });
    }

    const { data: recipient, error } = await supabase
      .from('document_recipients')
      .update({
        admin_signature: body.admin_signature,
        admin_signed_at: new Date().toISOString(),
        status: 'delivered',
        ...(body.inspector_signature !== undefined ? { inspector_signature: body.inspector_signature || null } : {}),
        ...(body.purchasing_signature !== undefined ? { purchasing_signature: body.purchasing_signature || null } : {}),
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    const { data: doc } = await supabase.from('documents').select('*').eq('id', recipient.document_id).single();
    if (!doc) throw new Error('Parent document not found');

    let deptName = '';
    const { data: dept } = await supabase.from('departments').select('name').eq('id', recipient.department_id).single();
    deptName = dept?.name || '';

    let profName = '';
    if (doc.recorded_by) {
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', doc.recorded_by).single();
      profName = prof?.full_name || '';
    }

    // Notify department via Upstash
    await notifyDepartment(recipient.department_id, {
      title: '📦 เอกสารใหม่ถึงหน่วยงาน',
      body: `เอกสาร #${doc.running_no}: ${doc.subject} จาก ${doc.sender}`,
      docId: recipient.id,
      runningNo: doc.running_no,
    });

    // Sync to Sheets (update this department's row only)
    const row = await findRowByValue('เอกสารเข้า', 21, recipient.id);
    if (row) {
      await updateRow('เอกสารเข้า', row, [
        String(doc.running_no), doc.received_date, doc.doc_number || '',
        doc.sender, doc.subject, deptName,
        'delivered', recipient.admin_signature || '', recipient.admin_signed_at || '',
        '', '', '', '', '',
        doc.is_damaged ? 'ใช่' : 'ไม่', doc.damage_image_url || '', doc.note || '',
        profName, recipient.updated_at, doc.tax_invoice_no || '', recipient.id,
      ]);
    }

    return NextResponse.json({
      success: true,
      data: { ...doc, ...recipient, id: recipient.id, document_id: doc.id, recipient_dept_id: recipient.department_id, recipient_dept_name: deptName, recorded_by_name: profName },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
