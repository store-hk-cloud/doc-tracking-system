import { getWorkerUser } from './auth';
import type { NotificationsEnvironment } from './env';

const RECIPIENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECEIPT_ERRORS: Record<string, [number, string] | undefined> = {
  receipt_actor_not_authenticated: [401, 'Not authenticated'],
  receipt_forbidden: [403, 'Forbidden'],
  document_recipient_not_found: [404, 'Document not found'],
  recipient_already_processed: [409, 'This document has already been processed'],
  receipt_invalid_verification: [400, 'document_recipient_id and is_verified are required'],
};

export async function handleDocumentReceipt(request: Request, env: NotificationsEnvironment): Promise<Response> {
  const headers = new Headers({ 'Cache-Control': 'private, no-store', Vary: 'Cookie' });
  const fail = (status: number, error: string) => Response.json({ success: false, error }, { status, headers });
  try {
    const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
    const publicKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const secretKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !publicKey || !secretKey) return fail(503, 'Service not configured');

    const url = new URL(supabaseUrl.endsWith('/') ? supabaseUrl : `${supabaseUrl}/`);
    const actor = await getWorkerUser(request, url, publicKey, headers);
    if (!actor) return fail(401, 'Not authenticated');

    const body = await request.json().catch(() => null) as {
      document_recipient_id?: unknown;
      is_verified?: unknown;
      recipient_signature?: unknown;
      verification_note?: unknown;
    } | null;
    if (!body?.document_recipient_id || typeof body.is_verified !== 'boolean') {
      return fail(400, 'document_recipient_id and is_verified are required');
    }
    if (typeof body.document_recipient_id !== 'string' || !RECIPIENT_UUID.test(body.document_recipient_id)) {
      return fail(404, 'Document not found');
    }
    if (body.verification_note != null && typeof body.verification_note !== 'string') {
      return fail(400, 'verification_note must be text');
    }

    const signature = String(body.recipient_signature || '').trim().slice(0, 255).replace(/[\uD800-\uDBFF]$/, '');
    const response = await fetch(new URL('rest/v1/rpc/receive_document_worker', url), {
      method: 'POST',
      headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_recipient_id: body.document_recipient_id, p_actor_id: actor.id, p_actor_email: actor.email || null,
        p_signature: signature || null, p_is_verified: body.is_verified, p_note: body.verification_note || null,
      }),
    });
    const result = await response.json().catch(() => null) as { delivery?: object; message?: string; code?: string } | null;
    if (response.ok && result?.delivery) return Response.json({ success: true, data: result.delivery }, { headers });
    const message = result?.message;
    const knownError = message && Object.hasOwn(RECEIPT_ERRORS, message) ? RECEIPT_ERRORS[message] : undefined;
    if (knownError) return fail(...knownError);
    const code = typeof result?.code === 'string' && /^(?:PGRST\d{3}|[0-9A-Z]{5})$/.test(result.code) ? result.code : undefined;
    console.error('[Document receipt] RPC response not confirmed', { status: response.status, code });
    // เก็บสถานะ 503 ให้ client ตรวจหลักฐานหลังคำขอที่อาจบันทึกสำเร็จแล้ว
    return fail(503, 'Unable to confirm document receipt');
  } catch {
    console.error('[Document receipt] Request not confirmed');
    return fail(503, 'Unable to confirm document receipt');
  }
}
