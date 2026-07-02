import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { updateRow, findRowByValue } from '@/lib/google-sheets';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from('documents')
      .select('*, departments(name), profiles(full_name)')
      .eq('id', id)
      .single();
    if (error) throw error;
    return NextResponse.json({
      success: true,
      data: { ...data, recipient_dept_name: data.departments?.name, recorded_by_name: data.profiles?.full_name },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const body = await request.json();

    const { data, error } = await supabase
      .from('documents')
      .update(body)
      .eq('id', id)
      .select('*, departments(name), profiles(full_name)')
      .single();

    if (error) throw error;

    // Sync to Sheets
    const row = await findRowByValue('เอกสารเข้า', 1, String(data.running_no));
    if (row) {
      updateRow('เอกสารเข้า', row, [
        String(data.running_no), data.received_date, data.doc_number || '',
        data.sender, data.subject, data.departments?.name || '',
        data.status, data.admin_signature || '', data.admin_signed_at || '',
        '', '', data.is_damaged ? 'ใช่' : 'ไม่',
        data.damage_image_url || '', data.note || '',
        data.profiles?.full_name || '', data.created_at, data.updated_at,
      ]);
    }

    return NextResponse.json({
      success: true,
      data: { ...data, recipient_dept_name: data.departments?.name },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const { error } = await supabase.from('documents').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}