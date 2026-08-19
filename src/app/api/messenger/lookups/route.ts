import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { requireCapability } from '@/lib/supabase/auth-helpers';

// ข้อมูล dropdown ของ Screen 1/2: สาขา, ธนาคารที่บริษัทอนุมัติ, และรายชื่อ
// แคชเชียร์ที่เลือกได้ (ผู้ใช้ที่ active — ช่อง "Dropdown/พิมพ์" ยอมให้พิมพ์ชื่อเองด้วย)
export async function GET() {
  try {
    const auth = await requireCapability({});
    if (auth.response) return auth.response;

    const supabase = getServiceSupabase();
    const [{ data: branches }, { data: banks }, { data: cashiers }] = await Promise.all([
      supabase.from('branches').select('id, name, code').eq('is_active', true).order('code'),
      supabase.from('approved_banks').select('id, name, code').eq('is_active', true).order('name'),
      supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name'),
    ]);

    return NextResponse.json({
      success: true,
      data: { branches: branches || [], banks: banks || [], cashiers: cashiers || [] },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
