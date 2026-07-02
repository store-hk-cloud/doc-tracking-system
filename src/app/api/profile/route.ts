import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getServiceSupabase } from '@/lib/supabase/admin';

export async function GET(request: NextRequest) {
  try {
    // Get user ID from auth session cookie
    const supabase = getServiceSupabase();
    
    const authHeader = request.headers.get('authorization') || '';
    const cookieAuth = request.cookies.get('sb-access-token')?.value;
    
    // Try to get user from the Supabase auth session
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

    // Fetch profile with service_role (bypasses RLS)
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ success: false, error: 'Profile not found' }, { status: 404 });
    }

    // Get department name
    let department_name = undefined;
    if (profile.department_id) {
      const { data: dept } = await supabase
        .from('departments')
        .select('name')
        .eq('id', profile.department_id)
        .single();
      department_name = dept?.name;
    }

    return NextResponse.json({
      success: true,
      data: { ...profile, department_name },
    });
  } catch (error: any) {
    console.error('[Profile API] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}