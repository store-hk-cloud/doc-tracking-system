import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { appendRow } from '@/lib/google-sheets';
import { requireRoles } from '@/lib/supabase/auth-helpers';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRoles(['super_admin', 'admin', 'user']);
    if (auth.response) return auth.response;

    const supabase = getServiceSupabase();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const dept_id = searchParams.get('dept_id');
    const keyword = searchParams.get('keyword');
    const date_from = searchParams.get('date_from');
    const date_to = searchParams.get('date_to');
    const limit = parseInt(searchParams.get('limit') || '0', 10);

    let query = supabase
      .from('documents')
      .select('*')
      .order('running_no', { ascending: false });

    if (auth.context?.profile.role === 'user') {
      query = query.eq('recipient_dept_id', auth.context.profile.department_id || '00000000-0000-0000-0000-000000000000');
    }

    if (limit > 0) query = query.limit(limit);

    if (status) query = query.eq('status', status);
    if (dept_id) query = query.eq('recipient_dept_id', dept_id);
    if (keyword) {
      query = query.or(`sender.ilike.%${keyword}%,subject.ilike.%${keyword}%,doc_number.ilike.%${keyword}%`);
    }
    if (date_from) query = query.gte('received_date', date_from);
    if (date_to) query = query.lte('received_date', date_to);

    const { data, error } = await query;
    if (error) throw error;

    // Fetch department and profile names separately
    const deptIds = [...new Set((data || []).map((d: any) => d.recipient_dept_id).filter(Boolean))];
    const profileIds = [...new Set((data || []).map((d: any) => d.recorded_by).filter(Boolean))];
    const docIds = (data || []).map((d: any) => d.id);

    const [{ data: departments }, { data: profiles }, { data: deliveries }] = await Promise.all([
      supabase.from('departments').select('id, name').in('id', deptIds.length ? deptIds : ['none']),
      supabase.from('profiles').select('id, full_name').in('id', profileIds.length ? profileIds : ['none']),
      supabase
        .from('delivery_logs')
        .select('document_id, recipient_signature, recipient_signed_at')
        .in('document_id', docIds.length ? docIds : ['none'])
        .order('created_at', { ascending: false }),
    ]);

    const deptMap = new Map((departments || []).map((d: any) => [d.id, d.name]));
    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name]));
    // delivery_logs is ordered newest-first, so the first entry per document wins (latest attempt).
    const recipientSignatureMap = new Map<string, { signature: string; signedAt: string }>();
    for (const log of deliveries || []) {
      if (!recipientSignatureMap.has(log.document_id)) {
        recipientSignatureMap.set(log.document_id, { signature: log.recipient_signature, signedAt: log.recipient_signed_at });
      }
    }

    const mapped = (data || []).map((d: any) => ({
      ...d,
      recipient_dept_name: deptMap.get(d.recipient_dept_id) || null,
      recorded_by_name: profileMap.get(d.recorded_by) || null,
      recipient_signature: recipientSignatureMap.get(d.id)?.signature || null,
      recipient_signed_at: recipientSignatureMap.get(d.id)?.signedAt || null,
    }));

    return NextResponse.json({ success: true, data: mapped });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRoles(['super_admin', 'admin']);
    if (auth.response) return auth.response;

    const supabase = getServiceSupabase();
    const body = await request.json();

    if (!body.sender || !body.subject || !body.recipient_dept_id) {
      return NextResponse.json({ success: false, error: 'sender, subject and recipient_dept_id are required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('documents')
      .insert({
        received_date: body.received_date || new Date().toISOString().split('T')[0],
        doc_number: body.doc_number || null,
        sender: body.sender,
        subject: body.subject,
        recipient_dept_id: body.recipient_dept_id,
        note: body.note || null,
        is_damaged: body.is_damaged || false,
        damage_image_url: body.damage_image_url || null,
        recorded_by: auth.context!.user.id,
        status: 'registered',
      })
      .select()
      .single();

    if (error) throw error;

    // Get department name
    let deptName = '';
    if (data.recipient_dept_id) {
      const { data: dept } = await supabase
        .from('departments')
        .select('name')
        .eq('id', data.recipient_dept_id)
        .single();
      deptName = dept?.name || '';
    }

    // Get profile name
    let profileName = '';
    if (data.recorded_by) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', data.recorded_by)
        .single();
      profileName = prof?.full_name || '';
    }

    // Sync to Google Sheets (new unified layout, 19 columns)
    await appendRow('เอกสารเข้า', [
      String(data.running_no),           // A: Running No.
      data.received_date,                // B: วันที่รับ
      data.doc_number || '',             // C: เลขที่เอกสาร
      data.sender,                       // D: ผู้ส่ง
      data.subject,                      // E: เรื่อง
      deptName,                          // F: หน่วยงาน
      'registered',                      // G: สถานะ
      '',                                // H: ลายเซ็น Admin (empty until admin signs)
      '',                                // I: เวลา Admin ลงนาม
      '',                                // J: ชื่อผู้รับ (empty until delivery)
      '',                                // K: ลายเซ็นผู้รับ
      '',                                // L: เวลาผู้รับลงนาม
      '',                                // M: ผลการตรวจสอบ
      '',                                // N: หมายเหตุ (ผู้รับ)
      data.is_damaged ? 'ใช่' : 'ไม่',    // O: เสียหาย
      data.damage_image_url || '',        // P: รูปความเสียหาย
      data.note || '',                    // Q: หมายเหตุ
      profileName,                        // R: ผู้บันทึก
      '',                                 // S: updated_at
    ]);

    return NextResponse.json({
      success: true,
      data: { ...data, recipient_dept_name: deptName, recorded_by_name: profileName },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
