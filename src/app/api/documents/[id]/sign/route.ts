import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { syncRowInSheet } from '@/lib/google-sheets';
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

      // แต่ละด่านเซ็นได้ที่สถานะของคิวตัวเอง และย้อนแก้ชื่อได้ที่สถานะถัดไป
      // (ยังไม่ถูกปิดงาน) — ต้องตรงกับ getGoodsReceiptWorkflowAction ไม่งั้นปุ่ม
      // "แก้ไข" ที่หน้าเว็บแสดงตามฟังก์ชันนั้นจะกดแล้วได้ 409 ทุกครั้ง
      // เดิมจัดซื้อขาด 'awaiting_recipient' ไป ปุ่มแก้ไขจัดซื้อจึงใช้ไม่ได้เลย
      const allowedStatuses = stage === 'inspector'
        ? ['awaiting_inspector', 'awaiting_purchasing']
        : ['awaiting_purchasing', 'awaiting_recipient'];
      if (!allowedStatuses.includes(existingRecipient.status)) {
        return NextResponse.json({ success: false, error: `Cannot sign ${stage} at this stage` }, { status: 409 });
      }

      const actorProfile = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', auth.context!.user.id)
        .single();
      const actorName = actorProfile.data?.full_name || auth.context!.user.email || 'ผู้ใช้ระบบ';

      // อัปเดตสถานะ + บันทึก audit ใน transaction เดียวผ่านฟังก์ชันฝั่ง DB
      // (migration 024) เดิมอัปเดตสถานะก่อนแล้วค่อย insert audit ถ้า audit ล้ม
      // route ตอบ 500 ทั้งที่เอกสารเดินไปขั้นถัดไปแล้ว หลักฐานการเซ็นครั้งนั้น
      // หายไป และการลองใหม่จะถูกบันทึกเป็น 'updated' แทน 'signed' เพราะลายเซ็น
      // ถูกเขียนลงไปแล้วในรอบที่ล้ม
      //
      // ฟังก์ชันตัดสิน signed/updated จากลายเซ็นเดิมที่อ่านใต้ FOR UPDATE เอง
      // จึงไม่ต้องส่ง previousSignature ที่อ่านมาก่อนหน้าเข้าไป (อาจเก่าไปแล้ว)
      const { data: signed, error } = await supabase.rpc('sign_goods_receipt_stage', {
        p_recipient_id: id,
        p_stage: stage,
        p_signature: signature,
        p_actor_id: auth.context!.user.id,
        p_actor_name: actorName,
        p_allowed_status: allowedStatuses,
      } as any);

      if (error) {
        const stale = /stage_changed|document_recipient_not_found/.test(error.message || '');
        return NextResponse.json(
          {
            success: false,
            error: stale
              ? 'The approval stage has changed; refresh and try again'
              : error.message,
          },
          { status: stale ? 409 : 500 }
        );
      }
      const recipient = signed as any;

      const { data: doc } = await supabase.from('documents').select('*').eq('id', recipient.document_id).single();
      const { data: dept } = await supabase.from('departments').select('name').eq('id', recipient.department_id).single();
      let profName = '';
      if (doc?.recorded_by) {
        const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', doc.recorded_by).single();
        profName = prof?.full_name || '';
      }
      if (doc) {
        await syncRowInSheet(doc.received_date, [
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
    await syncRowInSheet(doc.received_date, [
        documentNo(doc), doc.received_date, doc.doc_number || '',
        doc.sender, doc.subject, deptName,
        recipient.status, recipient.admin_signature || '', recipient.admin_signed_at || '',
        '', '', '', '', '',
        doc.is_damaged ? 'ใช่' : 'ไม่', doc.damage_image_url || '', doc.note || '',
        profName, recipient.updated_at, doc.tax_invoice_no || '', recipient.id,
    ]);

    return NextResponse.json({
      success: true,
      data: { ...doc, ...recipient, id: recipient.id, document_id: doc.id, recipient_dept_id: recipient.department_id, recipient_dept_name: deptName, recorded_by_name: profName },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
