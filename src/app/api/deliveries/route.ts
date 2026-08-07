import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { updateRow, findRowByValue } from '@/lib/google-sheets';
import { canAccessDepartment, forbiddenResponse, requireRoles } from '@/lib/supabase/auth-helpers';

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
    const recipientName = recipientProfile?.full_name || auth.context!.user.email || '';
    const isVerified = body.is_verified === true;
    const newStatus = isVerified ? 'closed' : 'rejected';

    // Atomically flip the recipient row out of 'delivered' first. If two requests race,
    // only one WHERE status='delivered' update can succeed — the loser gets 409
    // instead of both inserting a delivery log for the same recipient row.
    const { data: recipient, error: recipientUpdateError } = await supabase
      .from('document_recipients')
      .update({ status: newStatus })
      .eq('id', body.document_recipient_id)
      .eq('status', 'delivered')
      .select()
      .single();

    if (recipientUpdateError || !recipient) {
      return NextResponse.json({ success: false, error: 'This document has already been processed' }, { status: 409 });
    }

    // Insert delivery log. recipient_signature is always the server-verified
    // profile name — never trust a client-supplied name for who signed.
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

      const row = await findRowByValue('เอกสารเข้า', 21, recipient.id);
      if (row) {
        await updateRow('เอกสารเข้า', row, [
          String(doc.running_no),           // A: Running No.
          doc.received_date,                // B: วันที่รับ
          doc.doc_number || '',             // C: เลขที่เอกสาร
          doc.sender,                       // D: ผู้ส่ง
          doc.subject,                      // E: เรื่อง
          deptName,                         // F: หน่วยงาน
          newStatus,                        // G: สถานะ (closed/rejected)
          recipient.admin_signature || '',  // H: ลายเซ็น Admin
          recipient.admin_signed_at || '',  // I: เวลา Admin ลงนาม
          recipientName,                     // J: recipient name from server-side profile
          recipientName,                     // K: ลายเซ็นผู้รับ (server-verified, not client input)
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

    return NextResponse.json({ success: true, data: delivery });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
