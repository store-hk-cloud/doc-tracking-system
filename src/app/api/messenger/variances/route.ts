import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { requireCapability, forbiddenResponse } from '@/lib/supabase/auth-helpers';
import { canViewCash } from '@/lib/permissions';

// GET /api/messenger/variances — คิว PENDING REVIEW ของฝ่ายการเงิน
// รายการเงินเกินมาก่อนเสมอ และเรียงตามอายุ เพื่อให้ "ปล่อยค้างเงียบ ๆ" มีต้นทุน
export async function GET(request: NextRequest) {
  try {
    const auth = await requireCapability({});
    if (auth.response) return auth.response;
    const ctx = auth.context!;
    if (!(await canViewCash(ctx))) return forbiddenResponse();

    const supabase = getServiceSupabase();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending_review';
    const kind = searchParams.get('variance_kind');

    let query = supabase
      .from('cash_variance_reports')
      .select('*, bank_deposits!inner(*)')
      .order('reported_at', { ascending: true });

    if (status !== 'all') query = query.eq('status', status);
    if (kind) query = query.eq('variance_kind', kind);

    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];
    const jobIds = [...new Set(rows.map((r: any) => r.bank_deposits?.job_id).filter(Boolean))];
    const bankIds = [...new Set(rows.map((r: any) => r.bank_deposits?.bank_id).filter(Boolean))];
    const profileIds = [...new Set(rows.map((r: any) => r.reported_by).filter(Boolean))];

    const [{ data: jobs }, { data: banks }, { data: profiles }] = await Promise.all([
      supabase
        .from('messenger_jobs')
        .select('id, job_no, status, branch_id, assigned_to, branches(name)')
        .in('id', jobIds.length ? jobIds : ['none']),
      supabase.from('approved_banks').select('id, name').in('id', bankIds.length ? bankIds : ['none']),
      supabase.from('profiles').select('id, full_name').in('id', profileIds.length ? profileIds : ['none']),
    ]);

    const jobMap = new Map((jobs || []).map((j: any) => [j.id, j]));
    const bankMap = new Map((banks || []).map((b: any) => [b.id, b.name]));
    const nameMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name]));

    const enriched = rows.map((r: any) => {
      const job = jobMap.get(r.bank_deposits?.job_id);
      return {
        ...r,
        deposit: {
          ...r.bank_deposits,
          bank_name: bankMap.get(r.bank_deposits?.bank_id) || null,
        },
        bank_deposits: undefined,
        job_id: r.bank_deposits?.job_id ?? null,
        job_no: job?.job_no ?? null,
        job_status: job?.status ?? null,
        branch_name: job?.branches?.name ?? null,
        reported_by_name: nameMap.get(r.reported_by) || null,
      };
    });

    // เงินเกินขึ้นก่อน (เซนสิทีฟที่สุด) แล้วเรียงตามอายุของรายการ
    enriched.sort((a: any, b: any) => {
      if (a.variance_kind !== b.variance_kind) return a.variance_kind === 'over' ? -1 : 1;
      return a.reported_at < b.reported_at ? -1 : 1;
    });

    return NextResponse.json({ success: true, data: enriched });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
