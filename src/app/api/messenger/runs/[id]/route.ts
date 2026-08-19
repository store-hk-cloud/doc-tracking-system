import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { requireCapability, forbiddenResponse } from '@/lib/supabase/auth-helpers';
import { canReadAudit, canSeeJob } from '@/lib/permissions';
import { loadRunBundle, enrichRunBundle } from '@/lib/messenger-data';

// GET /api/messenger/runs/[id] — งานหนึ่งใบพร้อมทุกอย่างที่ผูกกับมัน
// audit trail ส่งกลับเฉพาะฝ่ายการเงิน
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCapability({});
    if (auth.response) return auth.response;
    const ctx = auth.context!;

    const { id } = await params;
    const bundle = await loadRunBundle(id);
    if (!bundle) {
      return NextResponse.json({ success: false, error: 'ไม่พบงานนี้' }, { status: 404 });
    }
    if (!(await canSeeJob(ctx, bundle.job))) return forbiddenResponse();

    const enriched = await enrichRunBundle(bundle);

    let audit;
    if (await canReadAudit(ctx)) {
      const { data } = await getServiceSupabase()
        .from('messenger_job_audit')
        .select('*')
        .eq('job_id', id)
        .order('id');
      audit = data || [];
    }

    return NextResponse.json({ success: true, data: { ...enriched, audit } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
