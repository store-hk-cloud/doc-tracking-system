import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { updateRow, findRowByValue } from '@/lib/google-sheets';

export async function GET(request: NextRequest) {
  try {
    const supabase = getServiceSupabase();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const dept_id = searchParams.get('dept_id');
    const document_id = searchParams.get('document_id');

    let query = supabase
      .from('delivery_logs')
      .select('*, documents(*)')
      .order('created_at', { ascending: false });

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
    const supabase = getServiceSupabase();
    const body = await request.json();

    // Insert delivery log
    const { data: delivery, error: deliveryError } = await supabase
      .from('delivery_logs')
      .insert({
        document_id: body.document_id,
        recipient_id: body.recipient_id,
        recipient_signature: body.recipient_signature,
        is_verified: body.is_verified,
        verification_note: body.verification_note || null,
      })
      .select()
      .single();

    if (deliveryError) throw deliveryError;

    // Update document status
    const newStatus = body.is_verified ? 'signed' : 'rejected';
    const { data: doc } = await supabase
      .from('documents')
      .update({ status: newStatus, note: body.verification_note || undefined })
      .eq('id', body.document_id)
      .select()
      .single();

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
          body.recipient_name || '',        // J: ชื่อผู้รับ
          body.recipient_signature,         // K: ลายเซ็นผู้รับ
          delivery.recipient_signed_at,     // L: เวลาผู้รับลงนาม
          body.is_verified ? 'ถูกต้อง' : 'ไม่ถูกต้อง', // M: ผลการตรวจสอบ
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