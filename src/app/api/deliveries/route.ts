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
    const document_id = searchParams.get('document_id');

    let query = supabase
      .from('delivery_logs')
      .select('*, documents!inner(*)')
      .order('created_at', { ascending: false });

    if (auth.context?.profile.role === 'user') {
      query = query.eq('documents.recipient_dept_id', auth.context.profile.department_id || '00000000-0000-0000-0000-000000000000');
    }

    if (status === 'pending_verify') {
      query = query.eq('verified_by_admin', false);
    }
    if (dept_id) {
      query = query.eq('documents.recipient_dept_id', dept_id);
    }
    if (document_id) {
      query = query.eq('document_id', document_id);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Enrich with department and profile names
    const docIds = [...new Set((data || []).map((d: any) => d.document_id).filter(Boolean))];
    const profileIds = [...new Set((data || []).map((d: any) => d.recipient_id).filter(Boolean))];

    const [deptRes, profRes] = await Promise.all([
      docIds.length > 0
        ? supabase.from('documents').select('id, recipient_dept_id').in('id', docIds).then(async ({ data: docs }) => {
            if (!docs?.length) return [];
            const deptIds = [...new Set(docs.map((d: any) => d.recipient_dept_id).filter(Boolean))];
            if (!deptIds.length) return [];
            const { data: depts } = await supabase.from('departments').select('id, name').in('id', deptIds);
            return { docs, depts: new Map((depts || []).map((d: any) => [d.id, d.name])) };
          })
        : Promise.resolve([]),
      profileIds.length > 0
        ? supabase.from('profiles').select('id, full_name').in('id', profileIds).then(({ data }) => new Map((data || []).map((p: any) => [p.id, p.full_name])))
        : Promise.resolve(new Map()),
    ]);

    const deptByName = deptRes && Array.isArray(deptRes) ? new Map() : (deptRes as any)?.depts || new Map();
    const docDept = deptRes && Array.isArray(deptRes) ? new Map() : new Map((deptRes as any)?.docs?.map((d: any) => [d.id, deptByName.get(d.recipient_dept_id)]) || []);
    const profilesMap = profRes instanceof Map ? profRes : new Map();

    const enriched = (data || []).map((d: any) => ({
      ...d,
      documents: d.documents ? { ...d.documents, recipient_dept_name: docDept.get(d.document_id) || null } : d.documents,
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

    if (!body.document_id || typeof body.is_verified !== 'boolean') {
      return NextResponse.json({ success: false, error: 'document_id and is_verified are required' }, { status: 400 });
    }

    const { data: documentBefore, error: documentError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', body.document_id)
      .single();
    if (documentError || !documentBefore) {
      return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 });
    }
    if (!canAccessDepartment(auth.context!, documentBefore.recipient_dept_id)) return forbiddenResponse();

    const { data: recipient } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', auth.context!.user.id)
      .single();
    const recipientName = recipient?.full_name || auth.context!.user.email || '';
    const isVerified = body.is_verified === true;
    const newStatus = isVerified ? 'signed' : 'rejected';

    // Atomically flip the document out of 'delivered' first. If two requests race,
    // only one WHERE status='delivered' update can succeed — the loser gets 409
    // instead of both inserting a delivery log for the same document.
    const { data: doc, error: docUpdateError } = await supabase
      .from('documents')
      .update({ status: newStatus })
      .eq('id', body.document_id)
      .eq('status', 'delivered')
      .select()
      .single();

    if (docUpdateError || !doc) {
      return NextResponse.json({ success: false, error: 'This document has already been processed' }, { status: 409 });
    }

    // Insert delivery log. recipient_signature is always the server-verified
    // profile name — never trust a client-supplied name for who signed.
    const { data: delivery, error: deliveryError } = await supabase
      .from('delivery_logs')
      .insert({
        document_id: body.document_id,
        recipient_id: auth.context!.user.id,
        recipient_signature: recipientName,
        is_verified: isVerified,
        verification_note: body.verification_note || null,
      })
      .select()
      .single();

    if (deliveryError) throw deliveryError;

    // Sync to Sheets (unified - update existing row only)
    if (doc) {
      // Get department and profile names separately
      let deptName = '';
      if (doc.recipient_dept_id) {
        const { data: dept } = await supabase.from('departments').select('name').eq('id', doc.recipient_dept_id).single();
        deptName = dept?.name || '';
      }
      let profName = '';
      if (doc.recorded_by) {
        const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', doc.recorded_by).single();
        profName = prof?.full_name || '';
      }

      const row = await findRowByValue('เอกสารเข้า', 1, String(doc.running_no));
      if (row) {
        await updateRow('เอกสารเข้า', row, [
          String(doc.running_no),           // A: Running No.
          doc.received_date,                // B: วันที่รับ
          doc.doc_number || '',             // C: เลขที่เอกสาร
          doc.sender,                       // D: ผู้ส่ง
          doc.subject,                      // E: เรื่อง
          deptName,                         // F: หน่วยงาน
          newStatus,                        // G: สถานะ (signed/rejected)
          doc.admin_signature || '',        // H: ลายเซ็น Admin
          doc.admin_signed_at || '',        // I: เวลา Admin ลงนาม
          recipientName,                     // J: recipient name from server-side profile
          recipientName,                     // K: ลายเซ็นผู้รับ (server-verified, not client input)
          delivery.recipient_signed_at,     // L: เวลาผู้รับลงนาม
          isVerified ? 'ถูกต้อง' : 'ไม่ถูกต้อง', // M: ผลการตรวจสอบ
          body.verification_note || '',     // N: หมายเหตุ (ผู้รับ)
          doc.is_damaged ? 'ใช่' : 'ไม่',    // O: เสียหาย
          doc.damage_image_url || '',        // P: รูปความเสียหาย
          doc.note || '',                    // Q: หมายเหตุ
          profName,                         // R: ผู้บันทึก
          doc.updated_at,                   // S: updated_at
        ]);
      }
    }

    return NextResponse.json({ success: true, data: delivery });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
