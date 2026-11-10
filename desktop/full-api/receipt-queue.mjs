import { RECEIPT_QUEUE_BATCH_LIMIT } from '@/lib/receipt-queue';
import { createServerSupabase } from './supabase-server.mjs';

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
const fail = (status, error) => Response.json({ success: false, error }, { status, headers });
const errors = {
  receipt_actor_not_authenticated: [401, 'Not authenticated'],
  receipt_forbidden: [403, 'Forbidden'],
  receipt_invalid_batch: [400, 'ข้อมูลคิวรับเอกสารไม่ถูกต้อง'],
  receipt_invalid_signature: [400, 'ข้อมูลคิวรับเอกสารไม่ถูกต้อง'],
  receipt_batch_conflict: [409, 'ชุดนี้ถูกส่งเข้าคิวแล้ว กรุณาตรวจหน้ารายการ'],
  receipt_queue_busy: [429, 'มีคิวรับเอกสารของคุณรออยู่หลายชุด กรุณารอให้บางชุดเสร็จก่อน'],
};

function getQueueItems(input) {
  if (!Array.isArray(input) || !input.length || input.length > RECEIPT_QUEUE_BATCH_LIMIT) return null;
  const seen = new Set();
  const items = [];
  for (const item of input) {
    if (typeof item?.recipient_id !== 'string' || !UUID.test(item.recipient_id) ||
        typeof item.expected_updated_at !== 'string' || !ISO_TIMESTAMP.test(item.expected_updated_at) ||
        !Number.isFinite(Date.parse(item.expected_updated_at))) return null;
    const id = item.recipient_id.toLowerCase();
    if (seen.has(id)) return null;
    seen.add(id);
    items.push({ recipientId: id, expectedUpdatedAt: item.expected_updated_at });
  }
  return items;
}

async function callQueue(rpc, args, enqueue = false) {
  try {
    const client = await createServerSupabase();
    const { data, error } = await client.rpc(rpc, args);
    if (!error && (enqueue ? data?.id : Array.isArray(data))) {
      return Response.json({ success: true, data }, { status: enqueue ? 202 : 200, headers });
    }
    if (Object.hasOwn(errors, error?.message)) return fail(...errors[error.message]);
    console.error('[Desktop receipt queue] RPC request not confirmed', { code: error?.code });
  } catch {
    console.error('[Desktop receipt queue] Request not confirmed');
  }
  return fail(503, 'ยืนยันผลจากคิวไม่ได้ กรุณาตรวจหน้ารายการแล้วลองใหม่');
}

export function GET() {
  return callQueue('list_desktop_receipt_batches');
}

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const items = getQueueItems(body?.items);
  const signature = typeof body?.signature === 'string' ? body.signature.trim().slice(0, 255).replace(/[\uD800-\uDBFF]$/, '') : '';
  if (typeof body?.batch_id !== 'string' || !UUID.test(body.batch_id) || !signature || !items) {
    return fail(400, 'ข้อมูลคิวรับเอกสารไม่ครบ กรุณาโหลดรายการใหม่');
  }
  return callQueue('enqueue_desktop_receipts', {
    p_batch_id: body.batch_id,
    p_signature_name: signature,
    p_items: items,
  }, true);
}
