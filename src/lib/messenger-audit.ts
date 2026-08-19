import type { NextRequest } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import type { AuthContext } from '@/lib/supabase/auth-helpers';

/**
 * Audit trail ของโมดูลเงินสด — append-only ที่ระดับ DB (trigger บล็อก
 * UPDATE/DELETE/TRUNCATE แม้เรียกด้วย service-role)
 *
 * กฎเดียวกับ src/app/api/deliveries/route.ts:111-121 — `actor_signature`
 * เขียนจาก `profiles.full_name` ที่ query ด้วย `ctx.user.id` เท่านั้น
 * **ไม่รับชื่อผู้ทำจาก request body ในทุกกรณี**
 *
 * ต่างจาก Google Sheets mirror ที่ swallow error ได้: audit ต้องเขียนสำเร็จ
 * ถ้าเขียนไม่ได้ให้ throw เพื่อให้ route ตอบ error ไม่ใช่บันทึกเงินแบบไร้ร่องรอย
 */

export type AuditEntity = 'job' | 'pickup' | 'deposit' | 'variance_report' | 'variance_review' | 'photo';

export type AuditEntry = {
  job_id: string;
  entity: AuditEntity;
  entity_id?: string | null;
  action: string;
  from_status?: string | null;
  to_status?: string | null;
  amount_satang?: number | null;
  variance_satang?: number | null;
  reason?: string | null;
  payload?: Record<string, unknown> | null;
};

/** ชื่อผู้ทำที่เชื่อถือได้ — มาจาก DB เท่านั้น */
export async function getActorName(userId: string, fallback?: string): Promise<string> {
  const { data } = await getServiceSupabase()
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .single();
  return data?.full_name || fallback || '';
}

function clientMeta(request?: NextRequest) {
  if (!request) return { request_ip: null, user_agent: null };
  const forwarded = request.headers.get('x-forwarded-for');
  return {
    request_ip: (forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip')) || null,
    user_agent: request.headers.get('user-agent')?.slice(0, 500) || null,
  };
}

export async function appendAudit(
  ctx: AuthContext,
  entry: AuditEntry,
  request?: NextRequest
): Promise<void> {
  const supabase = getServiceSupabase();
  const actorSignature = await getActorName(ctx.user.id, ctx.user.email);
  const { request_ip, user_agent } = clientMeta(request);

  const { error } = await supabase.from('messenger_job_audit').insert({
    job_id: entry.job_id,
    entity: entry.entity,
    entity_id: entry.entity_id ?? null,
    action: entry.action,
    from_status: entry.from_status ?? null,
    to_status: entry.to_status ?? null,
    amount_satang: entry.amount_satang ?? null,
    variance_satang: entry.variance_satang ?? null,
    reason: entry.reason ?? null,
    actor_id: ctx.user.id,
    actor_signature: actorSignature,
    actor_role: ctx.profile.role,
    actor_dept_code: ctx.profile.department_code,
    request_ip,
    user_agent,
    payload: entry.payload ?? null,
  });

  if (error) {
    // audit เขียนไม่ได้ = ถือว่าการกระทำนั้นล้มเหลว ไม่ปล่อยให้เงินขยับแบบไร้ร่องรอย
    throw new Error(`ไม่สามารถบันทึก audit ได้: ${error.message}`);
  }
}
