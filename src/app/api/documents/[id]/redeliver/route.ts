import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { updateRowInSheet, findRowLocation } from '@/lib/google-sheets';
import { requireRoles } from '@/lib/supabase/auth-helpers';
import { isGoodsReceipt as isGoodsReceiptSubject } from '@/lib/document-workflow';
import { documentNo } from '@/lib/document-no';

// [id] here is a document_recipients.id. A rejected goods receipt starts its
// inspection workflow again; other document types return straight to receiving.
export async function PUT(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRoles(['super_admin', 'admin']);
    if (auth.response) return auth.response;

    const { id } = await params;
    const supabase = getServiceSupabase();

    const { data: before, error: beforeError } = await supabase
      .from('document_recipients')
      .select('*')
      .eq('id', id)
      .eq('status', 'rejected')
      .single();
    if (beforeError || !before) {
      return NextResponse.json(
        { success: false, error: 'Only rejected documents can be redelivered' },
        { status: 409 }
      );
    }

    const { data } = await supabase.from('documents').select('*').eq('id', before.document_id).single();
    if (!data) throw new Error('Parent document not found');
    // ใช้ predicate ร่วม ไม่เทียบสตริงตรงนี้เอง: ชื่อเรื่องที่ hardcode ซ้ำหลายไฟล์
    // คือต้นเหตุที่การล็อกปลายทางเพี้ยนไปคนละทางระหว่างหน้าเว็บกับ API
    const isGoodsReceipt = isGoodsReceiptSubject(data.subject);
    const status = isGoodsReceipt ? 'awaiting_inspector' : 'delivered';

    const { data: recipient, error } = await supabase
      .from('document_recipients')
      .update({
        status,
        ...(isGoodsReceipt ? {
          inspector_signature: null,
          inspector_signed_by: null,
          inspector_signed_at: null,
          purchasing_signature: null,
          purchasing_signed_by: null,
          purchasing_signed_at: null,
        } : {}),
      })
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

    if (isGoodsReceipt && (before.inspector_signature || before.purchasing_signature)) {
      const { data: actor } = await supabase.from('profiles').select('full_name').eq('id', auth.context!.user.id).single();
      const actorName = actor?.full_name || auth.context!.user.email || 'ผู้ใช้ระบบ';
      const entries = [
        before.inspector_signature && {
          document_recipient_id: id, stage: 'inspector', action: 'reset',
          signature: null, previous_signature: before.inspector_signature,
          actor_id: auth.context!.user.id, actor_name: actorName,
        },
        before.purchasing_signature && {
          document_recipient_id: id, stage: 'purchasing', action: 'reset',
          signature: null, previous_signature: before.purchasing_signature,
          actor_id: auth.context!.user.id, actor_name: actorName,
        },
      ].filter(Boolean);
      if (entries.length) {
        const { error: auditError } = await supabase.from('document_approval_audit').insert(entries);
        if (auditError) throw auditError;
      }
    }

    let deptName = '';
    const { data: dept } = await supabase.from('departments').select('name').eq('id', recipient.department_id).single();
    deptName = dept?.name || '';

    let profName = '';
    if (data.recorded_by) {
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', data.recorded_by).single();
      profName = prof?.full_name || '';
    }

    const location = await findRowLocation(21, recipient.id);
    if (location) {
      await updateRowInSheet(location.sheet, location.row, [
        documentNo(data), data.received_date, data.doc_number || '',
        data.sender, data.subject, deptName,
        status, recipient.admin_signature || '', recipient.admin_signed_at || '',
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
