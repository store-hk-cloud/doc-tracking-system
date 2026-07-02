import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { updateRow, findRowByValue, appendRow } from '@/lib/google-sheets';
import { notifyDepartment } from '@/lib/upstash';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = getServiceSupabase();
    const body = await request.json();

    const { data, error } = await supabase
      .from('documents')
      .update({
        admin_signature: body.admin_signature,
        admin_signed_at: new Date().toISOString(),
        status: 'delivered',
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Get department and profile names separately
    let deptName = '';
    if (data.recipient_dept_id) {
      const { data: dept } = await supabase.from('departments').select('name').eq('id', data.recipient_dept_id).single();
      deptName = dept?.name || '';
    }
    let profName = '';
    if (data.recorded_by) {
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', data.recorded_by).single();
      profName = prof?.full_name || '';
    }

    // Notify department via Upstash
    await notifyDepartment(data.recipient_dept_id, {
      title: '📦 เอกสารใหม่ถึงหน่วยงาน',
      body: `เอกสาร #${data.running_no}: ${data.subject} จาก ${data.sender}`,
      docId: data.id,
      runningNo: data.running_no,
    });

    // Sync to Sheets (update existing row with admin signature)
    const row = await findRowByValue('เอกสารเข้า', 1, String(data.running_no));
    if (row) {
      await updateRow('เอกสารเข้า', row, [
        String(data.running_no),           // A: Running No.
        data.received_date,                // B: วันที่รับ
        data.doc_number || '',             // C: เลขที่เอกสาร
        data.sender,                       // D: ผู้ส่ง
        data.subject,                      // E: เรื่อง
        deptName,                          // F: หน่วยงาน
        'delivered',                       // G: สถานะ
        data.admin_signature || '',        // H: ลายเซ็น Admin
        data.admin_signed_at || '',        // I: เวลา Admin ลงนาม
        '',                                // J: ชื่อผู้รับ (waiting for recipient)
        '',                                // K: ลายเซ็นผู้รับ
        '',                                // L: เวลาผู้รับลงนาม
        '',                                // M: ผลการตรวจสอบ
        '',                                // N: หมายเหตุ (ผู้รับ)
        data.is_damaged ? 'ใช่' : 'ไม่',    // O: เสียหาย
        data.damage_image_url || '',        // P: รูปความเสียหาย
        data.note || '',                    // Q: หมายเหตุ
        profName,                          // R: ผู้บันทึก
        data.updated_at,                   // S: updated_at
      ]);
    }

    return NextResponse.json({ success: true, data: { ...data, recipient_dept_name: deptName, recorded_by_name: profName } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}