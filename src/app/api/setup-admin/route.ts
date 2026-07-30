import { NextResponse } from 'next/server';

// Bootstrap must happen from a trusted server-side environment. Keeping this
// route disabled prevents anyone on the internet from minting a super_admin.
export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: 'Bootstrap admin creation is disabled. Create the first admin from a trusted server-side script.',
    },
    { status: 410 }
  );
}
