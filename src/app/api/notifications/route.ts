import { NextResponse } from 'next/server';
import { getNotifications, clearNotifications } from '@/lib/upstash';
import { getAuthContext, unauthorizedResponse } from '@/lib/supabase/auth-helpers';

export async function GET() {
  const context = await getAuthContext();
  if (!context) return unauthorizedResponse();

  if (!context.profile.department_id) {
    return NextResponse.json({ success: true, data: [] });
  }

  const data = await getNotifications(context.profile.department_id);
  return NextResponse.json({ success: true, data });
}

export async function DELETE() {
  const context = await getAuthContext();
  if (!context) return unauthorizedResponse();

  if (context.profile.department_id) {
    await clearNotifications(context.profile.department_id);
  }
  return NextResponse.json({ success: true });
}
