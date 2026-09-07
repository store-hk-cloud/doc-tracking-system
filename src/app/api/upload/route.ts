import { NextRequest, NextResponse } from 'next/server';
import { uploadImage } from '@/lib/vercel-blob';
import { requireRoles } from '@/lib/supabase/auth-helpers';

// ค่าเดียวกับ api/upload-to-drive และ api/messenger/runs/[id]/photos
const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

// file.name ถูกต่อเข้าไปใน key ของ blob ตรง ๆ ชื่อที่มี / หรือ .. จึงเปลี่ยน
// ตำแหน่งที่ไฟล์ไปลงได้ ต้องล้างก่อนเสมอ
function safeFileName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() || 'upload';
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned.slice(-120) || 'upload';
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRoles(['super_admin', 'admin']);
    if (auth.response) return auth.response;

    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: 'อัปโหลดได้เฉพาะไฟล์รูปภาพ (JPEG, PNG, WebP, HEIC)' },
        { status: 415 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: 'ไฟล์ใหญ่เกินไป กรุณาถ่ายใหม่หรือย่อขนาดก่อน' },
        { status: 413 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = `damage/${Date.now()}-${safeFileName(file.name)}`;
    const url = await uploadImage(fileName, buffer, file.type);

    return NextResponse.json({ success: true, data: { url } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE() {
  return NextResponse.json(
    { success: false, error: 'File deletion endpoint is disabled until ownership tracking is implemented.' },
    { status: 410 }
  );
}
