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

    // เงื่อนไข verified_by_admin=false ต้องอยู่ในคำสั่ง update ด้วย ไม่ใช่เช็ค
    // จากค่าที่อ่านมาก่อนหน้าเท่านั้น — สองคำขอที่มาพร้อมกันจะผ่านการเช็คข้างบน
    // ทั้งคู่ แล้วเขียนเวลาปิดงานทับกันและ sync Sheets ซ้ำ
    const { data: delivery, error: deliveryError } = await supabase
      .from('delivery_logs')
      .update({
        verified_by_admin: true,
        verified_by_admin_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('verified_by_admin', false)
      .select()
      .single();

    if (deliveryError || !delivery) {
      return NextResponse.json(
        { success: false, error: 'Delivery is already verified' },
        { status: 409 }
      );
    }

    // ต้องเช็ค error ของคำสั่งนี้ด้วย: เดิมอ่านแค่ data ถ้าอัปเดตสถานะล้มเหลว
    // delivery จะถูกยืนยันไปแล้วแต่เอกสารยังไม่ closed และ API ยังตอบ success
    // ทำให้หน้าเว็บแสดงว่าปิดงานสำเร็จทั้งที่เอกสารค้างอยู่
    //
    // คืนสถานะ delivery กลับให้กดใหม่ได้ ไม่ปล่อยให้ค้างครึ่งทาง
    // (ไม่มี transaction ข้าม HTTP ได้กับ supabase-js จึงต้องชดเชยแบบนี้)
    const { data: recipient, error: recipientError } = await supabase
      .from('document_recipients')
      .update({ status: 'closed' })
      .eq('id', delivery.document_recipient_id)
      .select()
      .single();

    if (recipientError || !recipient) {
      await supabase
        .from('delivery_logs')
        .update({ verified_by_admin: false, verified_by_admin_at: null })
        .eq('id', id);
      return NextResponse.json(
        { success: false, error: recipientError?.message || 'ปิดงานเอกสารไม่สำเร็จ กรุณาลองใหม่' },
        { status: 500 }
      );
    }

    // Sync to Sheets — best-effort เหมือน route อื่น ปิดงานสำเร็จแล้วในฐานข้อมูล
    const { data: doc } = await supabase.from('documents').select('*').eq('id', recipient.document_id).single();
    if (doc) {
      const { data: dept } = await supabase.from('departments').select('name').eq('id', recipient.department_id).single();
      const deptName = dept?.name || '';

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

    return NextResponse.json({ success: true, data: delivery });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
