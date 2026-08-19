import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { requireCapability, forbiddenResponse } from '@/lib/supabase/auth-helpers';
import { canCreateCashJob, canViewCash, isMessenger } from '@/lib/permissions';
import { appendAudit } from '@/lib/messenger-audit';

// GET /api/messenger/runs — คิวงาน
// แมสเซนเจอร์เห็นงานตัวเอง / การเงินเห็นทุกงาน
export async function GET(request: NextRequest) {
  try {
    const auth = await requireCapability({});
    if (auth.response) return auth.response;
    const ctx = auth.context!;

    const supabase = getServiceSupabase();
    const { searchParams } = new URL(request.url);
    const statuses = searchParams.getAll('status');
    const branchId = searchParams.get('branch_id');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const limit = Math.min(Number(searchParams.get('limit')) || 100, 500);

    let query = supabase
      .from('messenger_jobs')
      .select('*, cash_pickups(payin_amount_satang, envelope_count), bank_deposits(actual_amount_satang, variance_satang, status, slip_status)')
      .eq('job_kind', 'cash_handover')
      .order('created_at', { ascending: false })
      .limit(limit);

    // คนที่ไม่ใช่ฝ่ายการเงินเห็นได้แค่งานที่ตัวเองรับผิดชอบหรือสร้าง
    if (!(await canViewCash(ctx))) {
      query = query.or(`assigned_to.eq.${ctx.user.id},created_by.eq.${ctx.user.id}`);
    }
    if (statuses.length > 0) query = query.in('status', statuses);
    if (branchId) query = query.eq('branch_id', branchId);
    if (dateFrom) query = query.gte('created_at', dateFrom);
    if (dateTo) query = query.lte('created_at', `${dateTo}T23:59:59.999Z`);

    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];
    const branchIds = [...new Set(rows.map((r: any) => r.branch_id).filter(Boolean))];
    const profileIds = [...new Set(rows.map((r: any) => r.assigned_to).filter(Boolean))];

    const [{ data: branches }, { data: profiles }] = await Promise.all([
      supabase.from('branches').select('id, name').in('id', branchIds.length ? branchIds : ['none']),
      supabase.from('profiles').select('id, full_name').in('id', profileIds.length ? profileIds : ['none']),
    ]);
    const branchMap = new Map((branches || []).map((b: any) => [b.id, b.name]));
    const nameMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name]));

    const enriched = rows.map((r: any) => {
      // supabase คืน embed เป็น array เมื่อความสัมพันธ์เป็น one-to-many
      const pickup = Array.isArray(r.cash_pickups) ? r.cash_pickups[0] : r.cash_pickups;
      const deposits = Array.isArray(r.bank_deposits) ? r.bank_deposits : r.bank_deposits ? [r.bank_deposits] : [];
      const deposit = deposits.find((d: any) => d?.status !== 'voided') || null;
      return {
        ...r,
        cash_pickups: undefined,
        bank_deposits: undefined,
        branch_name: branchMap.get(r.branch_id) || null,
        assigned_to_name: nameMap.get(r.assigned_to) || null,
        payin_amount_satang: pickup?.payin_amount_satang ?? null,
        envelope_count: pickup?.envelope_count ?? null,
        actual_amount_satang: deposit?.actual_amount_satang ?? null,
        variance_satang: deposit?.variance_satang ?? null,
        deposit_status: deposit?.status ?? null,
        slip_status: deposit?.slip_status ?? null,
      };
    });

    return NextResponse.json({ success: true, data: enriched });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST /api/messenger/runs — START (เลือกสาขา)
export async function POST(request: NextRequest) {
  try {
    const auth = await requireCapability({});
    if (auth.response) return auth.response;
    const ctx = auth.context!;
    if (!(await canCreateCashJob(ctx))) return forbiddenResponse();

    const supabase = getServiceSupabase();
    const body = await request.json();

    if (!body.branch_id) {
      return NextResponse.json({ success: false, error: 'กรุณาเลือกสาขา' }, { status: 400 });
    }

    // แมสเซนเจอร์สร้างงานได้เฉพาะของตัวเอง ฝ่ายการเงินสั่งงานให้คนอื่นได้
    let assignedTo = ctx.user.id;
    if (body.assigned_to && body.assigned_to !== ctx.user.id) {
      if (!(await canViewCash(ctx))) return forbiddenResponse();
      assignedTo = body.assigned_to;
    } else if (!(await isMessenger(ctx)) && !body.assigned_to) {
      return NextResponse.json(
        { success: false, error: 'กรุณาระบุแมสเซนเจอร์ผู้รับงาน' },
        { status: 400 }
      );
    }

    const { data: branch } = await supabase
      .from('branches')
      .select('id, is_active')
      .eq('id', body.branch_id)
      .single();
    if (!branch || !branch.is_active) {
      return NextResponse.json({ success: false, error: 'สาขาไม่ถูกต้องหรือปิดใช้งานแล้ว' }, { status: 400 });
    }

    // งานฝากเงินที่ยังไม่จบของคนเดิม ต้องปิดก่อนเปิดใบใหม่ — กันการเปิดงานใหม่
    // มาสวมแทนใบที่ถูกล็อกเพราะยอดเกิน
    const { data: openJobs } = await supabase
      .from('messenger_jobs')
      .select('id, job_no, status')
      .eq('assigned_to', assignedTo)
      .eq('job_kind', 'cash_handover')
      .in('status', ['open', 'picked_up', 'deposited', 'pending_review']);
    if (openJobs && openJobs.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `ยังมีงานฝากเงินที่ค้างอยู่ (เลขงาน ${openJobs.map((j: any) => j.job_no).join(', ')}) ต้องดำเนินการให้เสร็จก่อนเปิดงานใหม่`,
        },
        { status: 409 }
      );
    }

    const { data: job, error } = await supabase
      .from('messenger_jobs')
      .insert({
        job_kind: 'cash_handover',
        status: 'open',
        branch_id: body.branch_id,
        note: body.note || null,
        assigned_to: assignedTo,
        created_by: ctx.user.id,
      })
      .select()
      .single();
    if (error) throw error;

    await appendAudit(ctx, {
      job_id: job.id,
      entity: 'job',
      entity_id: job.id,
      action: 'create_run',
      to_status: 'open',
      payload: { branch_id: body.branch_id, assigned_to: assignedTo },
    }, request);

    return NextResponse.json({ success: true, data: job });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
