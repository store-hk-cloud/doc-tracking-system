import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { syncRowInSheet } from '@/lib/google-sheets';
import { requireRoles } from '@/lib/supabase/auth-helpers';
import { documentNo } from '@/lib/document-no';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRoles(['super_admin', 'admin']);
    if (auth.response) return auth.response;

    const { id } = await params;
    const supabase = getServiceSupabase();

    // ทั้งสองสถานะต้อง commit/rollback พร้อมกัน แม้เครือข่ายขาดระหว่างตอบกลับ
    const { data: verified, error } = await supabase.rpc('verify_document_delivery', {
      p_delivery_id: id,
    });
    if (error) {
      const expectedErrors: Record<string, { status: number; message: string }> = {
        delivery_not_found: { status: 404, message: 'Delivery not found' },
        delivery_already_verified: { status: 409, message: 'Delivery is already verified' },
        delivery_rejected: { status: 409, message: 'Rejected deliveries cannot be verified as closed' },
      };
      const expected = expectedErrors[error.message];
      return NextResponse.json(
        { success: false, error: expected?.message || 'ปิดงานเอกสารไม่สำเร็จ กรุณาโหลดข้อมูลใหม่แล้วลองอีกครั้ง' },
        { status: expected?.status || 500 }
      );
    }
    const { delivery, recipient } = verified;

    // Sync to Sheets — best-effort เหมือน route อื่น ปิดงานสำเร็จแล้วในฐานข้อมูล
    try {
      const { data: doc } = await supabase.from('documents').select('*').eq('id', recipient.document_id).single();
      if (doc) {
        const { data: dept } = await supabase.from('departments').select('name').eq('id', recipient.department_id).single();
        const deptName = dept?.name || '';

        let profName = '';
        if (doc.recorded_by) {
          const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', doc.recorded_by).single();
          profName = prof?.full_name || '';
        }
        const { data: recipientProfile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', delivery.recipient_id)
          .single();
        const accountName = recipientProfile?.full_name || '';

        await syncRowInSheet(doc.received_date, [
          documentNo(doc), doc.received_date, doc.doc_number || '',
          doc.sender, doc.subject, deptName,
          'closed', recipient.admin_signature || '', recipient.admin_signed_at || '',
          accountName, delivery.recipient_signature, delivery.recipient_signed_at,
          'ถูกต้อง', delivery.verification_note || '',
          doc.is_damaged ? 'ใช่' : 'ไม่',
          doc.damage_image_url || '', doc.note || '',
          profName, recipient.updated_at, doc.tax_invoice_no || '', recipient.id,
        ]);
      }
    } catch (syncError) {
      console.error('[Deliveries] ซิงก์ Sheets ไม่สำเร็จหลังปิดงานแล้ว:', syncError);
    }

    return NextResponse.json({ success: true, data: delivery });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
