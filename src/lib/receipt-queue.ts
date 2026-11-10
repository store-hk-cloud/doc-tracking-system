export const RECEIPT_QUEUE_BATCH_LIMIT = 50;

export type ReceiptQueueInput = { recipient_id: string; expected_updated_at: string };

export type ReceiptQueueItem = ReceiptQueueInput & {
  document_no: string | null;
  status: 'queued' | 'succeeded' | 'failed';
  error: string | null;
};

export type ReceiptQueueBatch = {
  id: string;
  created_at: string;
  items: ReceiptQueueItem[];
};

export const RECEIPT_QUEUE_URL = '/api/deliveries/queue';

export function receiptQueueError(code: string | null) {
  switch (code) {
    case 'receipt_stale': return 'ข้อมูลเอกสารเปลี่ยนแล้ว กรุณาตรวจรายการล่าสุด';
    case 'receipt_duplicate': return 'เอกสารรอบนี้อยู่ในคิวอื่นแล้ว';
    case 'recipient_already_processed': return 'เอกสารถูกดำเนินการแล้ว';
    case 'document_recipient_not_found': return 'ไม่พบเอกสาร';
    case 'receipt_forbidden':
    case 'receipt_actor_not_authenticated': return 'ไม่มีสิทธิ์รับเอกสารนี้แล้ว';
    default: return 'บันทึกไม่สำเร็จ กรุณาตรวจรายการแล้วลองใหม่';
  }
}
