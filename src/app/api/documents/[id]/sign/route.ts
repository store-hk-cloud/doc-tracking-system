import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { updateRow, findRowByValue, appendRow } from '@/lib/google-sheets';
import { notifyDepartment } from '@/lib/upstash';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const body = await request.json();

    const { data, error } = await supabase
      .from('documents')
      .update({
        admin_signature: body.admin_signature,
        admin_signed_at: new Date().toISOString(),
        status: 'delivered',
      })
      .eq('id', id)
      .select('*, departments(name), profiles(full_name)')
      .single();

    if (error) throw error;

    // Notify department via Upstash
    await notifyDepartment(data.recipient_dept_id, {
      title: '📦 เอกสารใหม่ถึงหน่วยงาน',
      body: `เอกสาร #${data.running_no}: ${data.subject} จาก ${data.sender}`,
      docId: data.id,
      runningNo: data.running_no,
    });

    // Sync to Sheets
    const row = await findRowByValue('เอกสารเข้า', 1, String(data.running_no));
    if (row) {
      updateRow('เอกสารเข้า', row, [
        String(data.running_no), data.received_date, data.doc_number || '',
        data.sender, data.subject, data.departments?.name || '',
        'delivered', data.admin_signature || '', data.admin_signed_at || '',
        '', '', data.is_damaged ? 'ใช่' : 'ไม่',
        data.damage_image_url || '', data.note || '',
        data.profiles?.full_name || '', data.created_at, data.updated_at,
      ]);
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}