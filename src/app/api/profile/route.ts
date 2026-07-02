import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getServiceSupabase } from '@/lib/supabase/admin';

export async function GET(request: NextRequest) {
  try {
    const supabase = getServiceSupabase();
    
    // Get user from auth session cookie
    const authClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: () => {},
        },
      }
    );
    const { data: { user } } = await authClient.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    // Fetch profile and department in parallel
    const [{ data: profile }, { data: depts }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('departments').select('id, name'),
    ]);

    if (!profile) {
      return NextResponse.json({ success: false, error: 'Profile not found' }, { status: 404 });
    }

    const deptMap = new Map((depts || []).map((d: any) => [d.id, d.name]));
    const department_name = profile.department_id ? deptMap.get(profile.department_id) : undefined;

    return NextResponse.json({
      success: true,
      data: { ...profile, department_name },
    });
  } catch (error: any) {
    console.error('[Profile API] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
