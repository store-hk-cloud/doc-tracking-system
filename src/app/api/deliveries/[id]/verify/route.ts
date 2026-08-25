import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { updateRowInSheet, findRowLocation } from '@/lib/google-sheets';
import { requireRoles } from '@/lib/supabase/auth-helpers';
import { documentNo } from '@/lib/document-no';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRoles(['super_admin', 'admin']);
    if (auth.response) return auth.response;

    const { id } = await params;
    const supabase = getServiceSupabase();

    const { data: existingDeliveryData, error: existingDeliveryError } = await supabase
      .from('delivery_logs')
      .select('id, document_recipient_id, is_verified, verified_by_admin')
      .eq('id', id)
      .single();
    const existingDelivery = existingDeliveryData as {
      id: string;
      document_recipient_id: string;
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

    // Update this department's recipient row to closed
    const { data: recipient } = await supabase
      .from('document_recipients')
      .update({ status: 'closed' })
      .eq('id', delivery.document_recipient_id)
      .select()
      .single();

    // Sync to Sheets
    if (recipient) {
      const { data: doc } = await supabase.from('documents').select('*').eq('id', recipient.document_id).single();
      if (doc) {
        let deptName = '';
        const { data: dept } = await supabase.from('departments').select('name').eq('id', recipient.department_id).single();
        deptName = dept?.name || '';

        let profName = '';
        if (doc.recorded_by) {
          const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', doc.recorded_by).single();
          profName = prof?.full_name || '';
        }

        const location = await findRowLocation(21, recipient.id);
        if (location) {
          await updateRowInSheet(location.sheet, location.row, [
            documentNo(doc), doc.received_date, doc.doc_number || '',
            doc.sender, doc.subject, deptName,
            'closed', recipient.admin_signature || '', recipient.admin_signed_at || '',
            delivery.recipient_signature, delivery.recipient_signature, delivery.recipient_signed_at,
            'ถูกต้อง', delivery.verification_note || '',
            doc.is_damaged ? 'ใช่' : 'ไม่',
            doc.damage_image_url || '', doc.note || '',
            profName, recipient.updated_at, doc.tax_invoice_no || '', recipient.id,
          ]);
        }
      }
    }

    return NextResponse.json({ success: true, data: delivery });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
