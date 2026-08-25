import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { updateRowInSheet, findRowLocation } from '@/lib/google-sheets';
import { canAccessDepartment, forbiddenResponse, requireRoles } from '@/lib/supabase/auth-helpers';
import { ACCOUNTING_DEPARTMENT_CODE, isGoodsReceipt } from '@/lib/document-workflow';
import { documentNo } from '@/lib/document-no';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRoles(['super_admin', 'admin', 'user']);
    if (auth.response) return auth.response;

    const supabase = getServiceSupabase();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const dept_id = searchParams.get('dept_id');
    const document_recipient_id = searchParams.get('document_recipient_id');

    let query = supabase
      .from('delivery_logs')
      .select('*, document_recipients!inner(*)')
      .order('created_at', { ascending: false });

    if (auth.context?.profile.role === 'user') {
      query = query.eq('document_recipients.department_id', auth.context.profile.department_id || '00000000-0000-0000-0000-000000000000');
    }

    if (status === 'pending_verify') {
      query = query.eq('verified_by_admin', false);
    }
    if (dept_id) {
      query = query.eq('document_recipients.department_id', dept_id);
    }
    if (document_recipient_id) {
      query = query.eq('document_recipient_id', document_recipient_id);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Enrich with department name
    const deptIds = [...new Set((data || []).map((d: any) => d.document_recipients?.department_id).filter(Boolean))];
    const profileIds = [...new Set((data || []).map((d: any) => d.recipient_id).filter(Boolean))];

    const [{ data: departments }, { data: profiles }] = await Promise.all([
      supabase.from('departments').select('id, name').in('id', deptIds.length ? deptIds : ['none']),
      supabase.from('profiles').select('id, full_name').in('id', profileIds.length ? profileIds : ['none']),
    ]);

    const deptMap = new Map((departments || []).map((d: any) => [d.id, d.name]));
    const profilesMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name]));

    const enriched = (data || []).map((d: any) => ({
      ...d,
      document_recipients: d.document_recipients
        ? { ...d.document_recipients, recipient_dept_name: deptMap.get(d.document_recipients.department_id) || null }
        : d.document_recipients,
      recipient_name: profilesMap.get(d.recipient_id) || null,
    }));

    return NextResponse.json({ success: true, data: enriched });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRoles(['super_admin', 'admin', 'user']);
    if (auth.response) return auth.response;

    const supabase = getServiceSupabase();
    const body = await request.json();

    if (!body.document_recipient_id || typeof body.is_verified !== 'boolean') {
      return NextResponse.json({ success: false, error: 'document_recipient_id and is_verified are required' }, { status: 400 });
    }

    const { data: recipientBefore, error: recipientError } = await supabase
      .from('document_recipients')
      .select('*')
      .eq('id', body.document_recipient_id)
      .single();
    if (recipientError || !recipientBefore) {
      return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 });
    }
    if (!canAccessDepartment(auth.context!, recipientBefore.department_id)) return forbiddenResponse();

    const { data: recipientProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', auth.context!.user.id)
      .single();
    const accountName = recipientProfile?.full_name || auth.context!.user.email || '';

    // ลายเซ็นผู้รับพิมพ์ได้ เพราะคนที่มารับของจริงหน้าเคาน์เตอร์อาจไม่ใช่เจ้าของ
    // บัญชีที่ล็อกอิน (ฝากเพื่อนแผนกมารับ) การบังคับใช้ชื่อเจ้าของบัญชีทำให้
    // หลักฐานระบุคนผิด ซึ่งแย่กว่าการให้พิมพ์ชื่อจริงของผู้รับ
    //
    // สิ่งที่ยังพิสูจน์ได้เสมอ: delivery_logs.recipient_id เก็บบัญชีที่กดยืนยัน
    // ซึ่งมาจาก session ปลอมไม่ได้ ดังนั้นถ้าลายเซ็นกับบัญชีไม่ตรงกัน ยังตามหา
    // คนที่กดได้ทุกกรณี
    const typedSignature = String(body.recipient_signature || '').trim();
    const recipientName = typedSignature ? typedSignature.slice(0, 255) : accountName;
    const { data: parentDocument, error: parentDocumentError } = await supabase
      .from('documents')
      .select('subject')
      .eq('id', recipientBefore.document_id)
      .single();
    if (parentDocumentError || !parentDocument) throw parentDocumentError || new Error('Parent document not found');

    const isGoodsReceiptDocument = isGoodsReceipt(parentDocument.subject);
    if (isGoodsReceiptDocument && auth.context!.profile.department_code !== ACCOUNTING_DEPARTMENT_CODE) {
      return forbiddenResponse();
    }
    const expectedStatus = isGoodsReceiptDocument ? 'awaiting_recipient' : 'delivered';
    const isVerified = body.is_verified === true;
    const newStatus = isVerified ? 'closed' : 'rejected';

    // Atomically flip the recipient row out of its final receiving stage. If two
    // requests race, only one update can succeed — the loser gets 409.
    // instead of both inserting a delivery log for the same recipient row.
    const { data: recipient, error: recipientUpdateError } = await supabase
      .from('document_recipients')
      .update({ status: newStatus })
      .eq('id', body.document_recipient_id)
      .eq('status', expectedStatus)
      .select()
      .single();

    if (recipientUpdateError || !recipient) {
      return NextResponse.json({ success: false, error: 'This document has already been processed' }, { status: 409 });
    }

    // Insert delivery log. recipient_signature รับจากช่องที่ผู้ใช้พิมพ์ได้
    // (คนมารับจริงอาจไม่ใช่เจ้าของบัญชี) แต่ recipient_id มาจาก session เสมอ
    // จึงยังพิสูจน์ได้ว่าบัญชีใดเป็นผู้กดยืนยัน
    const { data: delivery, error: deliveryError } = await supabase
      .from('delivery_logs')
      .insert({
        document_recipient_id: body.document_recipient_id,
        document_id: recipient.document_id,
        recipient_id: auth.context!.user.id,
        recipient_signature: recipientName,
        is_verified: isVerified,
        verification_note: body.verification_note || null,
      })
      .select()
      .single();

    if (deliveryError) throw deliveryError;

    // Sync to Sheets (update this department's row only)
    //
    // ต้องเป็น best-effort: ณ จุดนี้เอกสารถูกรับเรียบร้อยแล้วในฐานข้อมูล ถ้า Sheets
    // ล้มแล้วปล่อยให้ throw จะไปโดน catch ด้านล่างและตอบ 500 ทั้งที่งานสำเร็จแล้ว
    // ผู้ใช้เห็น "ล้มเหลว" แล้วกดซ้ำ รอบสองได้ 409 ยิ่งสับสนหนักกว่าเดิม
    //
    // เห็นชัดตอนรับหลายรายการพร้อมกัน เพราะ findRowLocation อ่านทุกแท็บทุกแถวต่อ
    // หนึ่งรายการ รับ 50 รายการจึงยิง Sheets API หลายร้อยครั้งและชนโควตาได้ง่าย
    // ความล้มเหลวของกระจกข้อมูลต้องไม่กลายเป็นความล้มเหลวของงานจริง
    try {
    const { data: doc } = await supabase.from('documents').select('*').eq('id', recipient.document_id).single();
    if (doc) {
      let deptName = '';
      const { data: dept } = await supabase.from('departments').select('name').eq('id', recipient.department_id).single();
      deptName = dept?.name || '';
      let profName = '';
      if (doc.recorded_by) {
        const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', doc.recorded_by).single();
        profName = prof?.full_name || '';
      }

      const location = await findRowLocation(21, recipient.id);
      if (location) {
        await updateRowInSheet(location.sheet, location.row, [
          documentNo(doc),           // A: Running No.
          doc.received_date,                // B: วันที่รับ
          doc.doc_number || '',             // C: เลขที่เอกสาร
          doc.sender,                       // D: ผู้ส่ง
          doc.subject,                      // E: เรื่อง
          deptName,                         // F: หน่วยงาน
          newStatus,                        // G: สถานะ (closed/rejected)
          recipient.admin_signature || '',  // H: ลายเซ็น Admin
          recipient.admin_signed_at || '',  // I: เวลา Admin ลงนาม
          accountName,                       // J: บัญชีที่กดยืนยัน (จาก session ปลอมไม่ได้)
          recipientName,                     // K: ลายเซ็นผู้รับ (พิมพ์ได้ ถ้าไม่พิมพ์ใช้ชื่อบัญชี)
          delivery.recipient_signed_at,     // L: เวลาผู้รับลงนาม
          isVerified ? 'ถูกต้อง' : 'ไม่ถูกต้อง', // M: ผลการตรวจสอบ
          body.verification_note || '',     // N: หมายเหตุ (ผู้รับ)
          doc.is_damaged ? 'ใช่' : 'ไม่',    // O: เสียหาย
          doc.damage_image_url || '',        // P: รูปความเสียหาย
          doc.note || '',                    // Q: หมายเหตุ
          profName,                         // R: ผู้บันทึก
          recipient.updated_at,             // S: updated_at
          doc.tax_invoice_no || '',         // T: เลขใบกำกับภาษี
          recipient.id,                     // U: รหัสอ้างอิง
        ]);
      }
    }
    } catch (sheetsError: any) {
      console.error('[Deliveries] sync Google Sheets ไม่สำเร็จ (เอกสารถูกบันทึกแล้ว):', sheetsError?.message || sheetsError);
    }

    return NextResponse.json({ success: true, data: delivery });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
