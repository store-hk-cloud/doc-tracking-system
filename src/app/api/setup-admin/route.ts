import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const { email, password, full_name } = await request.json();
    const supabase = await createServerSupabase();

    // Check if admin already exists
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'super_admin')
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({
        success: true,
        message: '✅ Admin user already exists'
      });
    }

    // Get service role client for admin operations
    const serviceClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Create auth user
    const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) throw authError;

    // Get default department
    const { data: dept } = await supabase
      .from('departments')
      .select('id')
      .limit(1);

    // Create profile
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: authData.user.id,
        email,
        full_name,
        role: 'super_admin',
        department_id: dept?.[0]?.id || null,
      });

    if (profileError) throw profileError;

    return NextResponse.json({
      success: true,
      message: `✅ Admin user created! Login with: ${email}`
    });

  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}