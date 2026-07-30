import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { updateRow, findRowByValue } from '@/lib/google-sheets';
import { requireRoles } from '@/lib/supabase/auth-helpers';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRoles(['super_admin', 'admin']);
    if (auth.response) return auth.response;

    const { id } = await params;
    const supabase = getServiceSupabase();

    const { data: existingDeliveryData, error: existingDeliveryError } = await supabase
      .from('delivery_logs')
      .select('id, document_id, is_verified, verified_by_admin')
      .eq('id', id)
      .single();
    const existingDelivery = existingDeliveryData as {
      id: string;
      document_id: string;
      is_verified: boolean;
      verified_by_admin: boolean;
    } | null;
    if (existingDeliveryError || !existingDelivery) {
      return NextResponse.json({ success: false, error: 'Delivery not found' }, { status: 404 });
    }
    if (existingDelivery.verified_by_admin) {
      return NextResponse.json({ success: false, error: 'Delivery is already verified' }, { status: 409 });
    }
    if (!existingDelivery.is_verified) {
      return NextResponse.json({ success: false, error: 'Rejected deliveries cannot be verified as closed' }, { status: 409 });
    }

    const { data: delivery, error: deliveryError } = await supabase
      .from('delivery_logs')
      .update({
        verified_by_admin: true,
        verified_by_admin_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (deliveryError) throw deliveryError;

    // Update document to closed
    const { data: doc } = await supabase
      .from('documents')
      .update({ status: 'closed' })
      .eq('id', delivery.document_id)
      .select()
      .single();

    // Sync to Sheets
    if (doc) {
      // Get department name
      let deptName = '';
      if (doc.recipient_dept_id) {
        const { data: dept } = await supabase.from('departments').select('name').eq('id', doc.recipient_dept_id).single();
        deptName = dept?.name || '';
      }

      const row = await findRowByValue('เอกสารเข้า', 1, String(doc.running_no));
      if (row) {
        updateRow('เอกสารเข้า', row, [
          String(doc.running_no), doc.received_date, doc.doc_number || '',
          doc.sender, doc.subject, deptName,
          'closed', doc.admin_signature || '', doc.admin_signed_at || '',
          delivery.recipient_signature, delivery.recipient_signed_at,
          doc.is_damaged ? 'ใช่' : 'ไม่',
          doc.damage_image_url || '', doc.note || '',
          '', doc.created_at, doc.updated_at,
        ]);
      }
    }

    return NextResponse.json({ success: true, data: delivery });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
