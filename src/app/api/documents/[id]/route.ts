import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { updateRow, findRowByValue } from '@/lib/google-sheets';
import { canAccessDepartment, forbiddenResponse, requireRoles } from '@/lib/supabase/auth-helpers';

// [id] here is a document_recipients.id — a specific department's copy of a document.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRoles(['super_admin', 'admin', 'user']);
    if (auth.response) return auth.response;

    const { id } = await params;
    const supabase = getServiceSupabase();
    const { data: recipient, error: recipientError } = await supabase
      .from('document_recipients')
      .select('*')
      .eq('id', id)
      .single();
    if (recipientError || !recipient) {
      return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 });
    }
    if (!canAccessDepartment(auth.context!, recipient.department_id)) return forbiddenResponse();

    const { data, error } = await supabase.from('documents').select('*').eq('id', recipient.document_id).single();
    if (error) throw error;

    // Get department and profile names separately
    let recipient_dept_name = null;
    let recorded_by_name = null;
    const { data: dept } = await supabase.from('departments').select('name').eq('id', recipient.department_id).single();
    recipient_dept_name = dept?.name || null;
    if (data.recorded_by) {
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', data.recorded_by).single();
      recorded_by_name = prof?.full_name || null;
    }

    return NextResponse.json({
      success: true,
      data: {
        ...data,
        ...recipient,
        id: recipient.id,
        document_id: data.id,
        recipient_dept_id: recipient.department_id,
        recipient_dept_name,
        recorded_by_name,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// NOTE: unlike GET/DELETE above, [id] here is a documents.id (the shared row) —
// this endpoint edits document-level fields and currently has no UI caller.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRoles(['super_admin', 'admin']);
    if (auth.response) return auth.response;

    const { id } = await params;
    const supabase = getServiceSupabase();
    const body = await request.json();

    const { data: existing, error: existingError } = await supabase
      .from('documents')
      .select('status')
      .eq('id', id)
      .single();
    if (existingError || !existing) {
      return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 });
    }

    const allowedFields = [
      'received_date', 'doc_number', 'tax_invoice_no', 'sender', 'subject',
      'recipient_dept_id', 'note', 'is_damaged', 'damage_image_url',
    ] as const;
    if (Object.prototype.hasOwnProperty.call(body, 'recipient_dept_id') && existing.status !== 'registered') {
      return NextResponse.json(
        { success: false, error: 'recipient_dept_id can only be changed while the document is still registered' },
        { status: 409 }
      );
    }
    const updates = Object.fromEntries(
      allowedFields
        .filter((field) => Object.prototype.hasOwnProperty.call(body, field))
        .map((field) => [field, body[field]])
    );
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: false, error: 'No editable fields provided' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('documents')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    // Get department name
    let deptName = '';
    if (data.recipient_dept_id) {
      const { data: dept } = await supabase.from('departments').select('name').eq('id', data.recipient_dept_id).single();
      deptName = dept?.name || '';
    }

    // Get profile name
    let profName = '';
    if (data.recorded_by) {
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', data.recorded_by).single();
      profName = prof?.full_name || '';
    }

    // Sync to Sheets
    const row = await findRowByValue('เอกสารเข้า', 1, String(data.running_no));
    if (row) {
      updateRow('เอกสารเข้า', row, [
        String(data.running_no), data.received_date, data.doc_number || '',
        data.sender, data.subject, deptName,
        data.status, data.admin_signature || '', data.admin_signed_at || '',
        '', '', data.is_damaged ? 'ใช่' : 'ไม่',
        data.damage_image_url || '', data.note || '',
        profName, data.created_at, data.updated_at,
        data.tax_invoice_no || '',
      ]);
    }

    return NextResponse.json({
      success: true,
      data: { ...data, recipient_dept_name: deptName },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// [id] here is a document_recipients.id — deletes only that department's link.
// If it was the last remaining recipient of the parent document, the shared
// document row is deleted too (nothing left pointing at it).
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRoles(['super_admin']);
    if (auth.response) return auth.response;

    const { id } = await params;
    const supabase = getServiceSupabase();

    const { data: recipient, error: fetchError } = await supabase
      .from('document_recipients')
      .select('document_id')
      .eq('id', id)
      .single();
    if (fetchError || !recipient) {
      return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 });
    }

    const { error: deleteError } = await supabase.from('document_recipients').delete().eq('id', id);
    if (deleteError) throw deleteError;

    const { count } = await supabase
      .from('document_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', recipient.document_id);

    if (!count) {
      const { error: docDeleteError } = await supabase.from('documents').delete().eq('id', recipient.document_id);
      if (docDeleteError) throw docDeleteError;
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
