import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { requireRoles } from '@/lib/supabase/auth-helpers';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 500;

// สิทธิ์ตัดสินที่ฟังก์ชันฝั่ง DB จาก p_actor_id ซึ่งมาจาก session เท่านั้น
// ห้ามรับตัวตนจาก body เพราะ service client ข้าม RLS
const RPC_ERRORS: Record<string, [number, string]> = {
  order_invalid: [400, 'รายการที่จัดเรียงไม่ถูกต้อง'],
  order_forbidden: [403, 'ไม่มีสิทธิ์จัดเรียงเอกสารนี้'],
  order_stale: [409, 'รายการเปลี่ยนไปแล้ว กรุณารีเฟรชแล้วลองใหม่'],
  receipt_actor_not_authenticated: [401, 'Not authenticated'],
  receipt_forbidden: [403, 'Forbidden'],
};

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireRoles(['super_admin', 'admin', 'user']);
    if (auth.response) return auth.response;

    const body = await request.json().catch(() => null);
    const { scope, ids } = body ?? {};
    if (scope !== 'delivery' && scope !== 'stage') {
      return NextResponse.json({ success: false, error: 'scope ต้องเป็น delivery หรือ stage' }, { status: 400 });
    }
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_IDS
      || !ids.every((id: unknown) => typeof id === 'string' && UUID.test(id))) {
      return NextResponse.json({ success: false, error: `ids ต้องเป็น UUID จำนวน 1-${MAX_IDS} รายการ` }, { status: 400 });
    }

    const { data, error } = await getServiceSupabase().rpc('reorder_document_recipients', {
      p_actor_id: auth.context!.user.id,
      p_scope: scope,
      p_ids: ids,
    } as any);

    if (error) {
      // lock_timeout ของฟังก์ชันหมดเพราะมีคนอื่นถือแถวเดียวกันอยู่ PostgREST ส่ง SQLSTATE มาใน error.code
      if (error.code === '55P03' || /lock timeout/i.test(error.message || '')) {
        return NextResponse.json({ success: false, error: 'มีผู้อื่นกำลังแก้ไขรายการนี้ กรุณาลองใหม่' }, { status: 409 });
      }
      const code = Object.keys(RPC_ERRORS).find((key) => (error.message || '').includes(key));
      const [status, message] = code ? RPC_ERRORS[code] : [500, error.message];
      return NextResponse.json({ success: false, error: message }, { status });
    }
    return NextResponse.json({ success: true, data: { count: (data as any)?.count ?? 0 } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
