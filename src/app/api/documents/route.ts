import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { appendRow } from '@/lib/google-sheets';

export async function GET(request: NextRequest) {
  try {
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
    
    const [{ data: departments }, { data: profiles }] = await Promise.all([
      supabase.from('departments').select('id, name').in('id', deptIds.length ? deptIds : ['none']),
      supabase.from('profiles').select('id, full_name').in('id', profileIds.length ? profileIds : ['none']),
    ]);

    const deptMap = new Map((departments || []).map((d: any) => [d.id, d.name]));
    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name]));

    const mapped = (data || []).map((d: any) => ({
      ...d,
      recipient_dept_name: deptMap.get(d.recipient_dept_id) || null,
      recorded_by_name: profileMap.get(d.recorded_by) || null,
    }));

    return NextResponse.json({ success: true, data: mapped });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getServiceSupabase();
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

    // Sync to Google Sheets
    appendRow('เอกสารเข้า', [
      String(data.running_no),
      data.received_date,
      data.doc_number || '',
      data.sender,
      data.subject,
      deptName,
      'registered',
      '',
      '',
      '',
      '',
      data.is_damaged ? 'ใช่' : 'ไม่',
      data.damage_image_url || '',
      data.note || '',
      profileName,
      data.created_at,
      '',
    ]);

    return NextResponse.json({
      success: true,
      data: { ...data, recipient_dept_name: deptName, recorded_by_name: profileName },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}