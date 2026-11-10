import { RECEIPT_QUEUE_BATCH_LIMIT, type ReceiptQueueInput } from '../lib/receipt-queue';
import { getWorkerUser } from './auth';
import type { NotificationsEnvironment } from './env';

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function getQueueItems(input: unknown): ReceiptQueueInput[] | null {
  if (!Array.isArray(input) || !input.length || input.length > RECEIPT_QUEUE_BATCH_LIMIT) return null;
  const seen = new Set<string>();
  const items: ReceiptQueueInput[] = [];
  for (const item of input) {
    if (typeof item?.recipient_id !== 'string' || !UUID.test(item.recipient_id) ||
        typeof item.expected_updated_at !== 'string' || !ISO_TIMESTAMP.test(item.expected_updated_at) ||
        !Number.isFinite(Date.parse(item.expected_updated_at))) return null;
    const id = item.recipient_id.toLowerCase();
    if (seen.has(id)) return null;
    seen.add(id);
    items.push({ recipient_id: id, expected_updated_at: item.expected_updated_at });
  }
  return items;
}

export async function handleReceiptQueue(request: Request, env: NotificationsEnvironment): Promise<Response> {
  const headers = new Headers({ 'Cache-Control': 'private, no-store', Vary: 'Cookie' });
  const fail = (status: number, error: string) => Response.json({ success: false, error }, { status, headers });
  const enqueue = request.method === 'POST';
  if (request.method !== 'GET' && !enqueue) {
    headers.set('Allow', 'GET, POST');
    return fail(405, 'Method not allowed');
  }
  if (enqueue && request.headers.has('origin') && request.headers.get('origin') !== new URL(request.url).origin) {
    return fail(403, 'Forbidden');
  }

  try {
    const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
    const publicKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const secretKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !publicKey || !secretKey) return fail(503, 'Service not configured');
    const url = new URL(supabaseUrl.endsWith('/') ? supabaseUrl : `${supabaseUrl}/`);
    const actor = await getWorkerUser(request, url, publicKey, headers);
    if (!actor) return fail(401, 'Not authenticated');

    let rpc = 'list_document_receipt_batches';
    let args: object = { p_actor_id: actor.id };
    if (enqueue) {
      const body = await request.json().catch(() => null) as { batch_id?: unknown; signature?: unknown; items?: unknown } | null;
      const items = getQueueItems(body?.items);
      const signature = typeof body?.signature === 'string' ? body.signature.trim().slice(0, 255).replace(/[\uD800-\uDBFF]$/, '') : '';
      if (typeof body?.batch_id !== 'string' || !UUID.test(body.batch_id) || !signature || !items) {
        return fail(400, 'ข้อมูลคิวรับเอกสารไม่ครบ กรุณาโหลดรายการใหม่');
      }
      rpc = 'enqueue_document_receipts';
      args = { p_actor_id: actor.id, p_actor_email: actor.email || null, p_batch_id: body.batch_id, p_signature: signature, p_items: items };
    }

    const response = await fetch(new URL(`rest/v1/rpc/${rpc}`, url), {
      method: 'POST',
      headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const result = await response.json().catch(() => null) as { message?: string; id?: string } | null;
    if (response.ok && (enqueue ? result?.id : Array.isArray(result))) {
      return Response.json({ success: true, data: result }, { status: enqueue ? 202 : 200, headers });
    }
    if (result?.message === 'receipt_actor_not_authenticated') return fail(401, 'Not authenticated');
    if (result?.message === 'receipt_forbidden') return fail(403, 'Forbidden');
    if (result?.message === 'receipt_invalid_batch') return fail(400, 'ข้อมูลคิวรับเอกสารไม่ถูกต้อง');
    if (result?.message === 'receipt_batch_conflict') return fail(409, 'ชุดนี้ถูกส่งเข้าคิวแล้ว กรุณาตรวจหน้ารายการ');
    if (result?.message === 'receipt_queue_busy') return fail(429, 'มีคิวรับเอกสารของคุณรออยู่หลายชุด กรุณารอให้บางชุดเสร็จก่อน');
    console.error('[Receipt queue] RPC request not confirmed', { status: response.status });
  } catch {
    console.error('[Receipt queue] Request not confirmed');
  }
  return fail(503, 'ยืนยันผลจากคิวไม่ได้ กรุณาตรวจหน้ารายการแล้วลองใหม่');
}
