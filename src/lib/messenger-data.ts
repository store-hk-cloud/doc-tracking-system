import { getServiceSupabase } from '@/lib/supabase/admin';

/**
 * ตัวช่วยอ่านข้อมูลที่หลาย route ของโมดูลเงินสดใช้ร่วมกัน
 * เก็บไว้ที่เดียวเพื่อให้การ enrich ชื่อสาขา/ธนาคาร/คน ไม่กระจายไปทุก route
 */

export async function loadRunBundle(jobId: string) {
  const supabase = getServiceSupabase();

  const { data: job } = await supabase
    .from('messenger_jobs')
    .select('*')
    .eq('id', jobId)
    .single();
  if (!job) return null;

  // ตั้งแต่ 012 ทริปหนึ่งมีได้หลายจุดรับ ห้ามใช้ maybeSingle() ที่นี่
  // ไม่งั้นพอมีจุดรับใบที่สอง คิวรีจะ error ทั้งก้อนและหน้าจอว่างเปล่า
  const [{ data: pickups }, { data: deposit }, { data: photos }] = await Promise.all([
    supabase.from('cash_pickups').select('*').eq('job_id', jobId).order('picked_up_at'),
    supabase
      .from('bank_deposits')
      .select('*')
      .eq('job_id', jobId)
      .neq('status', 'voided')
      .maybeSingle(),
    supabase.from('messenger_job_photos').select('*').eq('job_id', jobId).order('created_at'),
  ]);

  let report: any = null;
  let reviews: any[] = [];
  if (deposit) {
    const { data: reportRow } = await supabase
      .from('cash_variance_reports')
      .select('*')
      .eq('deposit_id', deposit.id)
      .neq('status', 'returned')
      .maybeSingle();
    report = reportRow || null;
    if (report) {
      const { data: reviewRows } = await supabase
        .from('cash_variance_reviews')
        .select('*')
        .eq('report_id', report.id)
        .order('created_at');
      reviews = reviewRows || [];
    }
  }

  return {
    job,
    pickups: (pickups || []) as any[],
    deposit: deposit || null,
    report,
    reviews,
    photos: photos || [],
  };
}

/** ผูกชื่อสาขา/ธนาคาร/ผู้รับผิดชอบ และลิงก์รูป เข้ากับ bundle เพื่อส่งให้ client */
export async function enrichRunBundle(bundle: NonNullable<Awaited<ReturnType<typeof loadRunBundle>>>) {
  const supabase = getServiceSupabase();
  // supabase-js ในโปรเจกต์นี้ไม่มี generated types แถวที่อ่านมาจึงเป็น never
  // cast ตรงนี้ที่เดียวแทนการ cast กระจายทุกบรรทัด
  const job = bundle.job as any;
  const pickups = bundle.pickups as any[];
  const deposit = bundle.deposit as any;
  const photos = bundle.photos as any[];

  const profileIds = [
    ...new Set(
      [
        job.assigned_to,
        job.created_by,
        job.closed_by,
        ...pickups.map((p) => p.received_by),
        deposit?.submitted_by,
      ].filter(Boolean) as string[]
    ),
  ];
  // สาขาของทริปมาจากจุดรับแต่ละใบ ไม่ใช่จาก job.branch_id อีกแล้ว (012)
  const branchIds = [
    ...new Set([job.branch_id, ...pickups.map((p) => p.branch_id)].filter(Boolean) as string[]),
  ];

  const [{ data: branches }, { data: bank }, { data: profiles }] = await Promise.all([
    supabase
      .from('branches')
      .select('id, name, code')
      .in('id', branchIds.length ? branchIds : ['00000000-0000-0000-0000-000000000000']),
    deposit
      ? supabase.from('approved_banks').select('id, name').eq('id', deposit.bank_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('profiles').select('id, full_name').in('id', profileIds.length ? profileIds : ['none']),
  ]);

  const nameMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name]));
  const photoMap = new Map((photos || []).map((p: any) => [p.id, p.view_link]));
  const branchMap = new Map((branches || []).map((b: any) => [b.id, b.name]));

  const enrichedPickups = pickups.map((p) => ({
    ...p,
    branch_name: branchMap.get(p.branch_id) ?? null,
    envelope_photo_link: photoMap.get(p.envelope_photo_id) ?? null,
    receiver_name: nameMap.get(p.received_by) ?? null,
  }));
  // ยอดที่ควรฝากของทริป = ผลรวมยอดหน้าซองทุกใบ (ค่าเดียวกับที่ trigger
  // assert_expected_matches_pickups ตรวจตอนบันทึกการฝาก)
  const expectedTotalSatang = enrichedPickups.reduce(
    (s, p) => s + Number(p.envelope_amount_satang),
    0
  );

  return {
    job: {
      ...job,
      branch_name: branchMap.get(job.branch_id) ?? null,
      assigned_to_name: nameMap.get(job.assigned_to) ?? null,
      pickup_count: enrichedPickups.length,
      expected_total_satang: expectedTotalSatang,
    },
    pickups: enrichedPickups,
    expected_total_satang: expectedTotalSatang,
    deposit: deposit
      ? {
          ...deposit,
          bank_name: bank?.name ?? null,
          slip_photo_link: deposit.slip_photo_id ? photoMap.get(deposit.slip_photo_id) ?? null : null,
        }
      : null,
    report: bundle.report,
    reviews: bundle.reviews,
    photos: bundle.photos,
  };
}

/** แผนกที่ควรได้รับ notification เรื่องเงิน: FIN + ACC (+ แผนกเจ้าของสาขา) */
export async function financeDepartmentIds(): Promise<string[]> {
  const { data } = await getServiceSupabase()
    .from('departments')
    .select('id, code')
    .in('code', ['FIN', 'ACC']);
  return (data || []).map((d: any) => d.id);
}
