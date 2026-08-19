import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { uploadToDrive } from '@/lib/google-drive';
import { requireCapability, forbiddenResponse } from '@/lib/supabase/auth-helpers';
import { canSeeJob, canUploadEvidence } from '@/lib/permissions';
import { appendAudit, getActorName } from '@/lib/messenger-audit';

const PHOTO_KINDS = ['payin_slip', 'cash_envelope', 'deposit_slip', 'variance_doc', 'other'] as const;
const MAX_BYTES = 12 * 1024 * 1024; // client ย่อรูปมาแล้ว ค่านี้เป็นเพดานกันหลุด

/**
 * POST /api/messenger/runs/[id]/photos — อัปหลักฐานภาพ
 *
 * ทำไมไม่ใช้ /api/upload-to-drive เดิม: (1) route นั้นจำกัด role เป็น
 * super_admin|admin ซึ่งแมสเซนเจอร์ (role user) จะได้ 403 ทุกครั้ง
 * (2) ที่นี่ต้องคำนวณ sha256 ฝั่ง server แล้วผูกกับ job ในขั้นตอนเดียว
 * เพื่อให้ unique index กันการใช้รูปสลิปใบเดิมซ้ำสองงานทำงานได้
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCapability({});
    if (auth.response) return auth.response;
    const ctx = auth.context!;
    if (!(await canUploadEvidence(ctx))) return forbiddenResponse();

    const { id: jobId } = await params;
    const supabase = getServiceSupabase();

    const { data: job } = await supabase
      .from('messenger_jobs')
      .select('id, status, assigned_to, created_by')
      .eq('id', jobId)
      .single();
    if (!job) return NextResponse.json({ success: false, error: 'ไม่พบงานนี้' }, { status: 404 });
    if (!(await canSeeJob(ctx, job))) return forbiddenResponse();
    if (job.status === 'cancelled' || job.status === 'closed') {
      return NextResponse.json(
        { success: false, error: 'งานนี้ปิดแล้ว ไม่สามารถเพิ่มหลักฐานได้' },
        { status: 409 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const photoKind = String(formData.get('photo_kind') || '');
    const caption = (formData.get('caption') as string) || null;
    const lat = formData.get('lat') ? Number(formData.get('lat')) : null;
    const lng = formData.get('lng') ? Number(formData.get('lng')) : null;
    const accuracy = formData.get('gps_accuracy_m') ? Number(formData.get('gps_accuracy_m')) : null;

    if (!file) {
      return NextResponse.json({ success: false, error: 'ไม่พบไฟล์รูป' }, { status: 400 });
    }
    if (!PHOTO_KINDS.includes(photoKind as any)) {
      return NextResponse.json({ success: false, error: 'ชนิดรูปไม่ถูกต้อง' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: 'ไฟล์ใหญ่เกินไป กรุณาถ่ายใหม่หรือย่อขนาดก่อน' },
        { status: 413 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // hash จากไบต์จริงที่ได้รับ ไม่ใช่ค่าที่ client ส่งมา
    const sha256 = createHash('sha256').update(buffer).digest('hex');

    // เช็คซ้ำก่อนอัป Drive เพื่อไม่ทิ้งไฟล์ค้างไว้ตอน insert แล้วชน unique index
    if (photoKind === 'payin_slip' || photoKind === 'deposit_slip') {
      const { data: dup } = await supabase
        .from('messenger_job_photos')
        .select('id, job_id')
        .eq('content_sha256', sha256)
        .in('photo_kind', ['payin_slip', 'deposit_slip'])
        .maybeSingle();
      if (dup) {
        return NextResponse.json(
          {
            success: false,
            error:
              dup.job_id === jobId
                ? 'รูปนี้ถูกอัปโหลดไปแล้วในงานนี้'
                : 'รูปสลิปใบนี้ถูกใช้กับงานอื่นแล้ว กรุณาถ่ายสลิปของงานนี้',
          },
          { status: 409 }
        );
      }
    }

    const uploaderSignature = await getActorName(ctx.user.id, ctx.user.email);
    const fileName = `${jobId}-${photoKind}-${Date.now()}.jpg`;
    const { fileId, viewLink } = await uploadToDrive(fileName, buffer, file.type || 'image/jpeg', 'cash');

    const { data: photo, error } = await supabase
      .from('messenger_job_photos')
      .insert({
        job_id: jobId,
        photo_kind: photoKind,
        drive_file_id: fileId,
        view_link: viewLink,
        content_sha256: sha256,
        caption,
        taken_lat: Number.isFinite(lat as number) ? lat : null,
        taken_lng: Number.isFinite(lng as number) ? lng : null,
        gps_accuracy_m: Number.isFinite(accuracy as number) ? accuracy : null,
        uploaded_by: ctx.user.id,
        uploader_signature: uploaderSignature,
      })
      .select()
      .single();
    if (error) throw error;

    await appendAudit(ctx, {
      job_id: jobId,
      entity: 'photo',
      entity_id: photo.id,
      action: `upload_${photoKind}`,
      payload: { sha256, has_gps: lat !== null && lng !== null },
    }, request);

    return NextResponse.json({ success: true, data: photo });
  } catch (error: any) {
    console.error('[Messenger Photos] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
