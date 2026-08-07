import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { requireRoles } from '@/lib/supabase/auth-helpers';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const auth = await requireRoles(['super_admin', 'admin', 'user']);
    if (auth.response) return auth.response;

    const supabase = getServiceSupabase();
    const today = new Date().toISOString().split('T')[0];

    let query = supabase.from('document_recipients').select('status, department_id, documents!inner(is_damaged, received_date)');
    if (auth.context?.profile.role === 'user') {
      query = query.eq('department_id', auth.context.profile.department_id || '00000000-0000-0000-0000-000000000000');
    }
    const { data: all, error } = await query;

    if (error) throw error;

    const stats = {
      total: all?.length || 0,
      today: all?.filter((d: any) => d.documents?.received_date === today).length || 0,
      registered: all?.filter((d: any) => d.status === 'registered').length || 0,
      delivered: all?.filter((d: any) => d.status === 'delivered').length || 0,
      signed: all?.filter((d: any) => d.status === 'signed').length || 0,
      closed: all?.filter((d: any) => d.status === 'closed').length || 0,
      rejected: all?.filter((d: any) => d.status === 'rejected').length || 0,
      damaged: all?.filter((d: any) => d.documents?.is_damaged).length || 0,
    };

    return NextResponse.json({ success: true, data: stats });
  } catch (error: any) {
    console.error('[Stats] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
