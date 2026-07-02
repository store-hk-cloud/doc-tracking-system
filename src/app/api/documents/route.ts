import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { appendRow } from '@/lib/google-sheets';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const dept_id = searchParams.get('dept_id');
    const keyword = searchParams.get('keyword');
    const date_from = searchParams.get('date_from');
    const date_to = searchParams.get('date_to');

    let query = supabase
      .from('documents')
      .select('*, departments(name), profiles(full_name)')
      .order('running_no', { ascending: false });

    if (status) query = query.eq('status', status);
    if (dept_id) query = query.eq('recipient_dept_id', dept_id);
    if (keyword) {
      query = query.or(`sender.ilike.%${keyword}%,subject.ilike.%${keyword}%,doc_number.ilike.%${keyword}%`);
    }
    if (date_from) query = query.gte('received_date', date_from);
    if (date_to) query = query.lte('received_date', date_to);

    const { data, error } = await query;
    if (error) throw error;

    const mapped = data.map((d: any) => ({
      ...d,
      recipient_dept_name: d.departments?.name,
      recorded_by_name: d.profiles?.full_name,
    }));

    return NextResponse.json({ success: true, data: mapped });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const body = await request.json();
    
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
        recorded_by: body.recorded_by,
        status: 'registered',
      })
      .select('*, departments(name), profiles(full_name)')
      .single();

    if (error) throw error;

    // Sync to Google Sheets
    appendRow('เอกสารเข้า', [
      String(data.running_no),
      data.received_date,
      data.doc_number || '',
      data.sender,
      data.subject,
      data.departments?.name || '',
      'registered',
      '',
      '',
      '',
      '',
      data.is_damaged ? 'ใช่' : 'ไม่',
      data.damage_image_url || '',
      data.note || '',
      data.profiles?.full_name || '',
      data.created_at,
      '',
    ]);

    return NextResponse.json({
      success: true,
      data: { ...data, recipient_dept_name: data.departments?.name, recorded_by_name: data.profiles?.full_name },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}