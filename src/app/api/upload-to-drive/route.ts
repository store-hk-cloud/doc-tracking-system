import { NextRequest, NextResponse } from 'next/server';
import { uploadToDrive } from '@/lib/google-drive';
import { requireRoles } from '@/lib/supabase/auth-helpers';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRoles(['super_admin', 'admin']);
    if (auth.response) return auth.response;

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const folderName = (formData.get('folder') as string) || 'documents';

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = `${Date.now()}-${file.name}`;

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
