import { NextRequest, NextResponse } from 'next/server';
import { uploadImage } from '@/lib/vercel-blob';
import { requireRoles } from '@/lib/supabase/auth-helpers';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRoles(['super_admin', 'admin']);
    if (auth.response) return auth.response;

    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = `damage/${Date.now()}-${file.name}`;
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
