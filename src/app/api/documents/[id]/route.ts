import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { syncRowInSheet } from '@/lib/google-sheets';
import { canAccessDepartment, forbiddenResponse, requireRoles } from '@/lib/supabase/auth-helpers';
import { canViewGoodsReceiptWorkflow, isGoodsReceipt } from '@/lib/document-workflow';
import { documentNo } from '@/lib/document-no';

// [id] here is a document_recipients.id — a specific department's copy of a document.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRoles(['super_admin', 'admin', 'user']);
    if (auth.response) return auth.response;

    const { id } = await params;
    const supabase = getServiceSupabase();
    const { data: recipient, error: recipientError } = await supabase
      .from('document_recipients')
      .select('*')
      .eq('id', id)
      .single();
    if (recipientError || !recipient) {
      return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 });
    }
    const { data, error } = await supabase.from('documents').select('*').eq('id', recipient.document_id).single();
    if (error) throw error;
    // ใช้สิทธิ์อ่านเดียวกับหน้ารายการ ผู้บันทึกและผู้เซ็นก่อนหน้าต้องติดตามงานต่อได้
    const context = auth.context!;
    const canRead = context.profile.role !== 'user'
      || data.recorded_by === context.user.id
      || recipient.inspector_signed_by === context.user.id
      || recipient.purchasing_signed_by === context.user.id
      || (isGoodsReceipt(data.subject)
        ? canViewGoodsReceiptWorkflow(context.profile.department_code, recipient.status)
        : canAccessDepartment(context, recipient.department_id));
    if (!canRead) return forbiddenResponse();

    // Get department and profile names separately
    let recipient_dept_name = null;
    let recorded_by_name = null;
    const [{ data: dept }, { data: tags }] = await Promise.all([
      supabase.from('departments').select('name').eq('id', recipient.department_id).single(),
      supabase.from('document_department_tags').select('departments(name)').eq('document_id', data.id),
    ]);
    recipient_dept_name = dept?.name || null;
    if (data.recorded_by) {
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', data.recorded_by).single();
      recorded_by_name = prof?.full_name || null;
    }

    return NextResponse.json({
      success: true,
      data: {
        ...data,
        ...recipient,
        id: recipient.id,
        document_id: data.id,
        recipient_dept_id: recipient.department_id,
        recipient_dept_name,
        related_department_names: (tags || []).map((tag: any) => tag.departments?.name).filter(Boolean),
        recorded_by_name,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// NOTE: unlike GET/DELETE above, [id] here is a documents.id (the shared row) —
// this endpoint edits document-level fields and currently has no UI caller.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRoles(['super_admin', 'admin']);
    if (auth.response) return auth.response;

    const { id } = await params;
    const supabase = getServiceSupabase();
    const body = await request.json();

    // สถานะจริงอยู่ที่ document_recipients ตั้งแต่ migration 006 แล้ว
    //
    // ห้ามอ่าน documents.status มาตัดสินอะไร: คอลัมน์นั้นถูกแช่ค่าไว้ตั้งแต่ 006
    // ไม่มีโค้ดไหนเขียนมันอีก (ตรวจข้อมูลจริง: 587 แถวยังเป็น 'registered'
    // ทั้งที่ปลายทางของมันปิดงานไปแล้ว) เงื่อนไขที่เคยกันการย้ายปลายทางจึงเปิด
    // ให้ย้ายได้เกือบทุกใบ
    const { data: existingRecipients, error: existingError } = await supabase
      .from('document_recipients')
      .select('status')
      .eq('document_id', id);
    if (existingError) throw existingError;
    if (!existingRecipients || existingRecipients.length === 0) {
      return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 });
    }
    const allStillRegistered = existingRecipients.every((r: any) => r.status === 'registered');

    const allowedFields = [
      'received_date', 'doc_number', 'tax_invoice_no', 'sender', 'subject',
      'recipient_dept_id', 'note', 'is_damaged', 'damage_image_url',
    ] as const;
    if (Object.prototype.hasOwnProperty.call(body, 'recipient_dept_id') && !allStillRegistered) {
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

    // Get profile name
    let profName = '';
    if (data.recorded_by) {
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', data.recorded_by).single();
      profName = prof?.full_name || '';
    }

    // Sync to Sheets: this document may be linked to multiple departments, each
    // with its own sheet row (found via its own document_recipients.id).
    const { data: recipients } = await supabase.from('document_recipients').select('*').eq('document_id', data.id);
    const deptIds = [...new Set((recipients || []).map((r: any) => r.department_id).filter(Boolean))];
    const recipientIds = (recipients || []).map((r: any) => r.id);
    const [{ data: depts }, { data: deliveries }] = await Promise.all([
      supabase.from('departments').select('id, name').in('id', deptIds.length ? deptIds : ['none']),
      supabase
        .from('delivery_logs')
        .select('*')
        .in('document_recipient_id', recipientIds.length ? recipientIds : ['none'])
        .order('created_at', { ascending: false }),
    ]);
    const deptNameMap = new Map((depts || []).map((d: any) => [d.id, d.name]));
    const deliveryByRecipient = new Map<string, any>();
    for (const delivery of deliveries || []) {
      if (!deliveryByRecipient.has(delivery.document_recipient_id)) {
        deliveryByRecipient.set(delivery.document_recipient_id, delivery);
      }
    }
    const deliveryProfileIds = [...new Set((deliveries || []).map((delivery: any) => delivery.recipient_id).filter(Boolean))];
    const { data: deliveryProfiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', deliveryProfileIds.length ? deliveryProfileIds : ['none']);
    const deliveryProfileMap = new Map((deliveryProfiles || []).map((profile: any) => [profile.id, profile.full_name]));
    const awaitingReceipt = new Set(['registered', 'delivered', 'awaiting_inspector', 'awaiting_purchasing', 'awaiting_recipient']);

    for (const r of recipients || []) {
      const delivery = awaitingReceipt.has(r.status) ? null : deliveryByRecipient.get(r.id);
      await syncRowInSheet(data.received_date, [
          documentNo(data), data.received_date, data.doc_number || '',
          data.sender, data.subject, deptNameMap.get(r.department_id) || '',
          r.status, r.admin_signature || '', r.admin_signed_at || '',
          delivery ? (deliveryProfileMap.get(delivery.recipient_id) || '') : '',
          delivery?.recipient_signature || '', delivery?.recipient_signed_at || '',
          delivery ? (delivery.is_verified ? 'ถูกต้อง' : 'ไม่ถูกต้อง') : '',
          delivery?.verification_note || '',
          data.is_damaged ? 'ใช่' : 'ไม่', data.damage_image_url || '', data.note || '',
          profName, r.updated_at, data.tax_invoice_no || '', r.id,
      ]);
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// [id] here is a document_recipients.id — deletes only that department's link.
// If it was the last remaining recipient of the parent document, the shared
// document row is deleted too (nothing left pointing at it).
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRoles(['super_admin']);
    if (auth.response) return auth.response;

    const { id } = await params;
    const supabase = getServiceSupabase();

    const { data: recipient, error: fetchError } = await supabase
      .from('document_recipients')
      .select('document_id')
      .eq('id', id)
      .single();
    if (fetchError || !recipient) {
      return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 });
    }

    const { error: deleteError } = await supabase.from('document_recipients').delete().eq('id', id);
    if (deleteError) throw deleteError;

    const { count, error: countError } = await supabase
      .from('document_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', recipient.document_id);

    if (countError) throw countError;
    if (count === 0) {
      const { error: docDeleteError } = await supabase.from('documents').delete().eq('id', recipient.document_id);
      if (docDeleteError) throw docDeleteError;
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
