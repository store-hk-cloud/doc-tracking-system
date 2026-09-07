import { NextRequest, NextResponse } from 'next/server';
import { uploadToDrive } from '@/lib/google-drive';
import { requireRoles } from '@/lib/supabase/auth-helpers';

// เพดานและชนิดไฟล์ใช้ค่าเดียวกับ api/messenger/runs/[id]/photos ซึ่งเป็น
// มาตรฐานของโปรเจกต์อยู่แล้ว route นี้เดิมไม่ตรวจอะไรเลยทั้งที่เปิดถึง role user
const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

// โฟลเดอร์ปลายทางต้องมาจากรายการปิด ไม่ใช่ค่าที่ client ส่งมาอิสระ:
// ค่านี้ถูกต่อเข้าไปใน query string ของ Drive API (getOrCreateSubfolder) และ
// ใครที่ล็อกอินอยู่ก็ส่งค่าอะไรมาก็ได้ ทำให้สร้างโฟลเดอร์ทิ้งใน Drive ของบริษัท
// หรือยิงอักขระที่ทำให้ query เพี้ยนได้ ของจริงแอปส่งมาแค่ 'damage' ค่าเดียว
const ALLOWED_FOLDERS = ['damage', 'documents'];

/**
 * ตัดชื่อไฟล์ให้เหลือเฉพาะส่วนที่ปลอดภัย ไม่เชื่อ file.name ที่ client ส่งมา
 *
 * ตัดแค่ตัวคั่นพาธและจุดนำหน้า — ไม่ใช้ allowlist a-z0-9 เพราะ
 * ชื่อไฟล์ภาษาไทยจะกลายเป็น "_______" ทั้งหมด แล้วคนที่เปิดดูใน Drive อ่านไม่ออก
 */
function safeFileName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() || 'upload';
  // ตัดเฉพาะจุดนำหน้าและช่องว่างหัวท้าย ส่วนตัวคั่นพาธถูกตัดด้วย split ข้างบนแล้ว
  // ไม่ใช้ allowlist a-z0-9 เพราะชื่อไฟล์ภาษาไทยจะกลายเป็น "_______" ทั้งหมด
  // แล้วคนที่เปิดดูใน Drive อ่านไม่ออก
  const cleaned = base.replace(/^\.+/, '').trim();
  return cleaned.slice(-120) || 'upload';
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRoles(['super_admin', 'admin', 'user']);
    if (auth.response) return auth.response;

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const requestedFolder = String(formData.get('folder') || 'documents');
    const folderName = ALLOWED_FOLDERS.includes(requestedFolder) ? requestedFolder : 'documents';

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
    const fileName = `${Date.now()}-${safeFileName(file.name)}`;

    const { fileId, viewLink } = await uploadToDrive(fileName, buffer, file.type, folderName);

    return NextResponse.json({
      success: true,
      data: { fileId, viewLink, fileName },
    });
  } catch (error: any) {
    console.error('[Upload to Drive] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE() {
  return NextResponse.json(
    { success: false, error: 'File deletion endpoint is disabled until ownership tracking is implemented.' },
    { status: 410 }
  );
}
