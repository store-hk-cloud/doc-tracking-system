import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { syncRowInSheet } from '@/lib/google-sheets';
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

    let recipient: any;
    let error: any;
    if (isGoodsReceipt) {
      const { data: actor } = await supabase.from('profiles').select('full_name').eq('id', auth.context!.user.id).single();
      ({ data: recipient, error } = await supabase.rpc('reset_goods_receipt_stages', {
        p_recipient_id: id,
        p_actor_id: auth.context!.user.id,
        p_actor_name: actor?.full_name || auth.context!.user.email || 'ผู้ใช้ระบบ',
      } as any));
    } else {
      ({ data: recipient, error } = await supabase.from('document_recipients')
        .update({ status }).eq('id', id).eq('status', 'rejected').select('*').single());
    }
    if (error || !recipient) {
      const stale = !error || /stage_changed/.test(error.message || '')
        || (!isGoodsReceipt && error.code === 'PGRST116');
      return NextResponse.json(
        { success: false, error: stale ? 'Only rejected documents can be redelivered' : error.message },
        { status: stale ? 409 : 500 }
      );
    }

    let deptName = '';
    const { data: dept } = await supabase.from('departments').select('name').eq('id', recipient.department_id).single();
    deptName = dept?.name || '';

    let profName = '';
    if (data.recorded_by) {
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', data.recorded_by).single();
      profName = prof?.full_name || '';
    }

    await syncRowInSheet(data.received_date, [
        documentNo(data), data.received_date, data.doc_number || '',
        data.sender, data.subject, deptName,
        status, recipient.admin_signature || '', recipient.admin_signed_at || '',
        '', '', '', '', '',
        data.is_damaged ? 'ใช่' : 'ไม่', data.damage_image_url || '', data.note || '',
        profName, recipient.updated_at, data.tax_invoice_no || '', recipient.id,
    ]);

    return NextResponse.json({
      success: true,
      data: { ...data, ...recipient, id: recipient.id, document_id: data.id, recipient_dept_id: recipient.department_id, recipient_dept_name: deptName, recorded_by_name: profName },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
