import { NextRequest, NextResponse } from 'next/server';
import { uploadToDrive, deleteFromDrive, getDriveViewLink } from '@/lib/google-drive';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const folderName = (formData.get('folder') as string) || 'documents';

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = `${folderName}/${Date.now()}-${file.name}`;

    const { fileId, viewLink } = await uploadToDrive(fileName, buffer, file.type);

    return NextResponse.json({
      success: true,
      data: { fileId, viewLink, fileName },
    });
  } catch (error: any) {
    console.error('[Upload to Drive] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { fileId } = await request.json();

    if (!fileId) {
      return NextResponse.json({ success: false, error: 'No fileId provided' }, { status: 400 });
    }

    await deleteFromDrive(fileId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}