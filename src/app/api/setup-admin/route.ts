import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const { email, password, full_name } = await request.json();

    // Use service_role key directly (bypasses RLS)
    const serviceClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Check if admin already exists (using service_role)
    const { data: existing } = await serviceClient
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

    // Create auth user with service role
    const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) throw authError;

    // Get default department via service client
    const { data: dept } = await serviceClient
      .from('departments')
      .select('id')
      .limit(1);

    // Create profile via service_client (bypasses RLS)
    const { error: profileError } = await serviceClient
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