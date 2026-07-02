import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { appendRow, updateRow, findRowByValue } from '@/lib/google-sheets';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const dept_id = searchParams.get('dept_id');

    let query = supabase
      .from('delivery_logs')
      .select('*, documents!inner(*, departments(name), profiles(full_name)), profiles(full_name)')
      .order('created_at', { ascending: false });

    if (status === 'pending_verify') {
      query = query.eq('verified_by_admin', false);
    }
    if (dept_id) {
      query = query.eq('documents.recipient_dept_id', dept_id);
    }

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
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
      .select('*, departments(name), profiles(full_name)')
      .single();

    // Sync to Sheets
    if (doc) {
      const row = await findRowByValue('เอกสารเข้า', 1, String(doc.running_no));
      if (row) {
        updateRow('เอกสารเข้า', row, [
          String(doc.running_no), doc.received_date, doc.doc_number || '',
          doc.sender, doc.subject, doc.departments?.name || '',
          newStatus, doc.admin_signature || '', doc.admin_signed_at || '',
          body.recipient_signature, delivery.recipient_signed_at,
          doc.is_damaged ? 'ใช่' : 'ไม่',
          doc.damage_image_url || '', doc.note || '',
          doc.profiles?.full_name || '', doc.created_at, doc.updated_at,
        ]);
      }

      appendRow('ประวัติการส่งมอบ', [
        String(doc.running_no), doc.sender, doc.subject,
        body.recipient_name || '', doc.departments?.name || '',
        body.recipient_signature, delivery.recipient_signed_at,
        body.is_verified ? 'ถูกต้อง' : 'ไม่ถูกต้อง',
        body.verification_note || '', 'รอตรวจสอบ', '',
      ]);
    }

    return NextResponse.json({ success: true, data: delivery });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}