import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = await createServerSupabase();
    const today = new Date().toISOString().split('T')[0];

    const { data: all, error } = await supabase
      .from('documents')
      .select('status, is_damaged, received_date');

    if (error) throw error;

    const stats = {
      total: all?.length || 0,
      today: all?.filter((d: any) => d.received_date === today).length || 0,
      registered: all?.filter((d: any) => d.status === 'registered').length || 0,
      delivered: all?.filter((d: any) => d.status === 'delivered').length || 0,
      signed: all?.filter((d: any) => d.status === 'signed').length || 0,
      closed: all?.filter((d: any) => d.status === 'closed').length || 0,
      rejected: all?.filter((d: any) => d.status === 'rejected').length || 0,
      damaged: all?.filter((d: any) => d.is_damaged).length || 0,
    };

    return NextResponse.json({ success: true, data: stats });
  } catch (error: any) {
    console.error('[Stats] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}