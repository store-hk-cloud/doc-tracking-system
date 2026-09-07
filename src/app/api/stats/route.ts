import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { requireRoles } from '@/lib/supabase/auth-helpers';
import { bangkokDate } from '@/lib/thai-date';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const auth = await requireRoles(['super_admin', 'admin', 'user']);
    if (auth.response) return auth.response;

    const supabase = getServiceSupabase();
    // วันที่ไทย ไม่ใช่ UTC — ไม่งั้นสถิติ "วันนี้" จะเป็นของเมื่อวานตอนเช้ามืด
    const today = bangkokDate();

    // นับที่ฐานข้อมูล ไม่ดึงแถวมานับที่นี่
    //
    // เดิม select ทุกแถวแล้ว .filter().length ซึ่ง PostgREST ตัดให้แค่ 1000 แถว
    // ต่อคำขอ (เหตุผลเดียวกับที่ api/documents/route.ts ต้องมี fetchAllRows)
    // ผลคือพอเอกสารสะสมเกิน 1000 ตัวเลขทุกช่องบนหน้า Dashboard จะน้อยกว่าความจริง
    // แบบเงียบ ๆ ไม่มี error — ตอนตรวจมี 683 แถว เหลือระยะอีกแค่ ~300 แถว
    //
    // การนับด้วย head:true ไม่ดึงแถวเลย จึงไม่มีเพดานมาเกี่ยวและเบากว่าเดิมด้วย
    const scoped = <T extends { eq: (c: string, v: any) => T }>(q: T): T =>
      auth.context?.profile.role === 'user'
        ? q.eq('department_id', auth.context.profile.department_id || '00000000-0000-0000-0000-000000000000')
        : q;

    const countOf = async (build: (q: any) => any) => {
      const { count, error } = await build(
        scoped(supabase.from('document_recipients').select('id', { count: 'exact', head: true }) as any)
      );
      if (error) throw error;
      return count || 0;
    };

    const byStatus = (status: string) => countOf((q) => q.eq('status', status));

    const [total, todayCount, registered, delivered, signed, closed, rejected, damaged] = await Promise.all([
      countOf((q) => q),
      // กรองผ่าน embed ต้อง !inner ไม่งั้นเงื่อนไขบนตารางที่ join มาไม่มีผล
      (async () => {
        const { count, error } = await scoped(
          supabase
            .from('document_recipients')
            .select('id, documents!inner(received_date)', { count: 'exact', head: true }) as any
        ).eq('documents.received_date', today);
        if (error) throw error;
        return count || 0;
      })(),
      byStatus('registered'),
      byStatus('delivered'),
      byStatus('signed'),
      byStatus('closed'),
      byStatus('rejected'),
      (async () => {
        const { count, error } = await scoped(
          supabase
            .from('document_recipients')
            .select('id, documents!inner(is_damaged)', { count: 'exact', head: true }) as any
        ).eq('documents.is_damaged', true);
        if (error) throw error;
        return count || 0;
      })(),
    ]);

    return NextResponse.json({
      success: true,
      data: { total, today: todayCount, registered, delivered, signed, closed, rejected, damaged },
    });
  } catch (error: any) {
    console.error('[Stats] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
