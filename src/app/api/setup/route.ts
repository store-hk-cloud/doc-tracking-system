import { NextResponse } from 'next/server';

// Schema changes belong in Supabase migrations, never in a public HTTP route.
export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: 'Database setup endpoint is disabled. Apply Supabase migrations from a trusted environment.',
    },
    { status: 410 }
  );
}
