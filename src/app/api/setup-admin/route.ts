import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const { email, password, full_name } = await request.json();
    const serviceClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Check if admin profile exists
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

    // Check if auth user exists but profile missing
    const { data: authUsers } = await serviceClient.auth.admin.listUsers();
    const existingAuth = authUsers?.users?.find(u => u.email === email);

    let userId: string;

    if (existingAuth) {
      // Auth user exists, just create profile
      userId = existingAuth.id;
    } else {
      // Create new auth user
      const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (authError) throw authError;
      userId = authData.user.id;
    }

    // Get default department
    const { data: dept } = await serviceClient
      .from('departments')
      .select('id')
      .limit(1);

    // Create/upsert profile
    const { error: profileError } = await serviceClient
      .from('profiles')
      .upsert({
        id: userId,
        email,
        full_name: full_name || 'Admin',
        role: 'super_admin',
        department_id: dept?.[0]?.id || null,
      }, { onConflict: 'id' });

    if (profileError) throw profileError;

    return NextResponse.json({
      success: true,
      message: `✅ Admin user created! Login with: ${email} / ${password || 'Admin@123456'}`
    });

  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
