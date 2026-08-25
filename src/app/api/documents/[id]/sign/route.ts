import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { updateRowInSheet, findRowLocation } from '@/lib/google-sheets';
import { notifyDepartment } from '@/lib/upstash';
import { forbiddenResponse, requireRoles } from '@/lib/supabase/auth-helpers';
import { getGoodsReceiptWorkflowAction, isGoodsReceipt } from '@/lib/document-workflow';
import { documentNo } from '@/lib/document-no';

// [id] here is a document_recipients.id. ใบรับสินค้าใช้ recipient ของบัญชี
// เป็นตัวเก็บสถานะกลาง แต่สิทธิ์แต่ละขั้นตัดสินจาก department code โดยตรง.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRoles(['super_admin', 'admin', 'user']);
    if (auth.response) return auth.response;

    const { id } = await params;
    const supabase = getServiceSupabase();
    const body = await request.json();

    const isDelivering = !!body.admin_signature;
    const hasInspectorSig = body.inspector_signature !== undefined;
    const hasPurchasingSig = body.purchasing_signature !== undefined;
    if (!isDelivering && !hasInspectorSig && !hasPurchasingSig) {
      return NextResponse.json({ success: false, error: 'admin_signature, inspector_signature or purchasing_signature is required' }, { status: 400 });
    }

    const { data: existingRecipient, error: existingError } = await supabase
      .from('document_recipients')
      .select('status, department_id, document_id, inspector_signature, purchasing_signature, documents(recorded_by, subject)')
      .eq('id', id)
      .single();
    if (existingError || !existingRecipient) {
      return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 });
    }
    const parentDocument = (existingRecipient as any).documents;
    const isGoodsReceiptDocument = isGoodsReceipt(parentDocument?.subject);

    // 'user' may deliver to their own department OR any document they registered
    // themselves (cross-department); admin/super_admin are unrestricted either way.
    const recordedBy = parentDocument?.recorded_by;
    const isOwnDept = auth.context!.profile.department_id === existingRecipient.department_id;
    const isOwnDoc = recordedBy === auth.context!.user.id;
    const isApprovalAction = hasInspectorSig || hasPurchasingSig;

    if ((!isGoodsReceiptDocument || !isApprovalAction) && auth.context!.profile.role === 'user' && !isOwnDept && !isOwnDoc) {
      return forbiddenResponse();
    }

    if (isGoodsReceiptDocument && isApprovalAction) {
      if (isDelivering || hasInspectorSig === hasPurchasingSig) {
        return NextResponse.json({ success: false, error: 'Sign exactly one approval stage at a time' }, { status: 400 });
      }

      const stage = hasInspectorSig ? 'inspector' : 'purchasing';
      // ผู้ตรวจสอบ: คลังสินค้า หรือ FAC-PP (อย่างใดอย่างหนึ่ง)
      // จัดซื้อ: หน่วยงานจัดซื้อเท่านั้น — admin/super_admin ไม่มีสิทธิ์ข้าม.
      if (getGoodsReceiptWorkflowAction(auth.context!.profile.department_code, existingRecipient.status) !== stage) {
        return forbiddenResponse();
      }
      const signature = String(hasInspectorSig ? body.inspector_signature : body.purchasing_signature).trim().slice(0, 255);
      if (!signature) {
        return NextResponse.json({ success: false, error: 'Signature is required' }, { status: 400 });
      }

      const allowedStatuses = stage === 'inspector'
        ? ['awaiting_inspector', 'awaiting_purchasing']
        : ['awaiting_purchasing'];
      if (!allowedStatuses.includes(existingRecipient.status)) {
        return NextResponse.json({ success: false, error: `Cannot sign ${stage} at this stage` }, { status: 409 });
      }

      const previousSignature = stage === 'inspector'
        ? existingRecipient.inspector_signature
        : existingRecipient.purchasing_signature;
      const actorProfile = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', auth.context!.user.id)
        .single();
      const actorName = actorProfile.data?.full_name || auth.context!.user.email || 'ผู้ใช้ระบบ';
      const now = new Date().toISOString();
      const updates = stage === 'inspector'
        ? {
            inspector_signature: signature,
            inspector_signed_by: auth.context!.user.id,
            inspector_signed_at: now,
            status: 'awaiting_purchasing',
          }
        : {
            purchasing_signature: signature,
            purchasing_signed_by: auth.context!.user.id,
            purchasing_signed_at: now,
            status: 'awaiting_recipient',
          };

      const { data: recipient, error } = await supabase
        .from('document_recipients')
        .update(updates)
        .eq('id', id)
        .in('status', allowedStatuses)
        .select()
        .single();
      if (error || !recipient) {
        return NextResponse.json({ success: false, error: 'The approval stage has changed; refresh and try again' }, { status: 409 });
      }

      const { error: auditError } = await supabase.from('document_approval_audit').insert({
        document_recipient_id: id,
        stage,
        action: previousSignature ? 'updated' : 'signed',
        signature,
        previous_signature: previousSignature || null,
        actor_id: auth.context!.user.id,
        actor_name: actorName,
      });
      if (auditError) throw auditError;

      const { data: doc } = await supabase.from('documents').select('*').eq('id', recipient.document_id).single();
      const { data: dept } = await supabase.from('departments').select('name').eq('id', recipient.department_id).single();
      let profName = '';
      if (doc?.recorded_by) {
        const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', doc.recorded_by).single();
        profName = prof?.full_name || '';
      }
      const location = await findRowLocation(21, recipient.id);
      if (location && doc) {
        await updateRowInSheet(location.sheet, location.row, [
          documentNo(doc), doc.received_date, doc.doc_number || '',
          doc.sender, doc.subject, dept?.name || '',
          recipient.status, recipient.admin_signature || '', recipient.admin_signed_at || '',
          '', '', '', '', '',
          doc.is_damaged ? 'ใช่' : 'ไม่', doc.damage_image_url || '', doc.note || '',
          profName, recipient.updated_at, doc.tax_invoice_no || '', recipient.id,
        ]);
      }
      return NextResponse.json({
        success: true,
        data: {
          ...doc,
          ...recipient,
          id: recipient.id,
          document_id: recipient.document_id,
          recipient_dept_id: recipient.department_id,
          recipient_dept_name: dept?.name || '',
        },
      });
    }

    if (existingRecipient.status !== 'registered') {
      return NextResponse.json({ success: false, error: 'Only registered documents can be signed for delivery' }, { status: 409 });
    }

    // Only the sender's signature delivers the document. A goods receipt then
    // begins its recipient-department approval workflow before the receiver signs.
    const { data: recipient, error } = await supabase
      .from('document_recipients')
      .update({
        ...(isDelivering ? {
          admin_signature: body.admin_signature,
          admin_signed_at: new Date().toISOString(),
          status: isGoodsReceiptDocument ? 'awaiting_inspector' : 'delivered',
        } : {}),
        ...(hasInspectorSig ? { inspector_signature: body.inspector_signature || null } : {}),
        ...(hasPurchasingSig ? { purchasing_signature: body.purchasing_signature || null } : {}),
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

    // Notify department via Upstash only when the document is actually delivered
    if (isDelivering) {
      await notifyDepartment(recipient.department_id, {
        title: '📦 เอกสารใหม่ถึงหน่วยงาน',
        body: `เอกสาร ${documentNo(doc)}: ${doc.subject} จาก ${doc.sender}`,
        docId: recipient.id,
        runningNo: doc.running_no,
      });
    }

    // Sync to Sheets (update this department's row only, wherever its tab actually is)
    const location = await findRowLocation(21, recipient.id);
    if (location) {
      await updateRowInSheet(location.sheet, location.row, [
        documentNo(doc), doc.received_date, doc.doc_number || '',
        doc.sender, doc.subject, deptName,
        recipient.status, recipient.admin_signature || '', recipient.admin_signed_at || '',
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
