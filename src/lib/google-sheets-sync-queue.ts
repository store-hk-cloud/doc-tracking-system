import { randomUUID } from 'crypto';
import { documentNo } from './document-no';
import { appendRowsOrThrow, findRowLocation, updateRowInSheetOrThrow } from './google-sheets';
import { getServiceSupabase } from './supabase/admin';

type QueueJob = {
  document_recipient_id: string;
  revision: string;
  attempts?: number | null;
};

type SheetRow = {
  documentRecipientId: string;
  revision: string;
  sheetName: string;
  values: string[];
};

export type GoogleSheetsSyncResult = {
  processed: number;
  deferred: boolean;
  failed: number;
};

const AWAITING_RECEIPT = new Set([
  'registered', 'delivered', 'awaiting_inspector', 'awaiting_purchasing', 'awaiting_recipient',
]);

async function loadSheetRows(supabase: any, jobs: QueueJob[]): Promise<SheetRow[]> {
  const recipientIds = jobs.map((job) => job.document_recipient_id);
  const revisionByRecipient = new Map(jobs.map((job) => [job.document_recipient_id, job.revision]));
  const { data: recipients, error: recipientsError } = await supabase
    .from('document_recipients')
    .select('*')
    .in('id', recipientIds);
  if (recipientsError) throw recipientsError;

  const recipientRows = recipients || [];
  const documentIds = [...new Set(recipientRows.map((recipient: any) => recipient.document_id).filter(Boolean))];
  if (documentIds.length === 0) return [];

  const { data: documents, error: documentsError } = await supabase
    .from('documents')
    .select('*')
    .in('id', documentIds);
  if (documentsError) throw documentsError;
  const documentById = new Map<string, any>(
    (documents || []).map((document: any) => [document.id, document] as [string, any])
  );

  const departmentIds = [...new Set(recipientRows.map((recipient: any) => recipient.department_id).filter(Boolean))];
  const { data: departments, error: departmentsError } = await supabase
    .from('departments')
    .select('id, name')
    .in('id', departmentIds.length ? departmentIds : ['00000000-0000-0000-0000-000000000000']);
  if (departmentsError) throw departmentsError;
  const departmentNameById = new Map((departments || []).map((department: any) => [department.id, department.name]));

  const { data: deliveries, error: deliveriesError } = await supabase
    .from('delivery_logs')
    .select('*')
    .in('document_recipient_id', recipientIds)
    .order('created_at', { ascending: false })
    .order('id');
  if (deliveriesError) throw deliveriesError;
  const deliveryByRecipient = new Map<string, any>();
  for (const delivery of deliveries || []) {
    if (!deliveryByRecipient.has(delivery.document_recipient_id)) {
      deliveryByRecipient.set(delivery.document_recipient_id, delivery);
    }
  }

  const profileIds = [...new Set([
    ...(documents || []).map((document: any) => document.recorded_by),
    ...(deliveries || []).map((delivery: any) => delivery.recipient_id),
  ].filter(Boolean))];
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', profileIds.length ? profileIds : ['00000000-0000-0000-0000-000000000000']);
  if (profilesError) throw profilesError;
  const profileNameById = new Map((profiles || []).map((profile: any) => [profile.id, profile.full_name]));

  return recipientRows.flatMap((recipient: any): SheetRow[] => {
    const document = documentById.get(recipient.document_id);
    const revision = revisionByRecipient.get(recipient.id);
    if (!document || !revision) return [];
    const delivery = AWAITING_RECEIPT.has(recipient.status)
      ? null
      : deliveryByRecipient.get(recipient.id);
    return [{
      documentRecipientId: recipient.id,
      revision,
      sheetName: document.received_date,
      values: [
        documentNo(document), document.received_date, document.doc_number || '',
        document.sender, document.subject, departmentNameById.get(recipient.department_id) || '',
        recipient.status, recipient.admin_signature || '', recipient.admin_signed_at || '',
        delivery ? (profileNameById.get(delivery.recipient_id) || '') : '',
        delivery?.recipient_signature || '', delivery?.recipient_signed_at || '',
        delivery ? (delivery.is_verified ? 'ถูกต้อง' : 'ไม่ถูกต้อง') : '',
        delivery?.verification_note || '',
        document.is_damaged ? 'ใช่' : 'ไม่', document.damage_image_url || '', document.note || '',
        profileNameById.get(document.recorded_by) || '', recipient.updated_at || '',
        document.tax_invoice_no || '', recipient.id,
      ],
    }];
  });
}

async function releaseWriteLease(supabase: any, token: string) {
  try {
    const { error } = await supabase.rpc('release_sheet_write_lock', { p_token: token });
    if (error) console.error('[Google Sheets queue] ปลด lease ไม่สำเร็จ:', error);
  } catch (error) {
    // lease มีวันหมดอายุ จึงไม่ให้ความผิดพลาดตอนปลดล็อกปิดบังผลของงานที่ทำเสร็จแล้ว
    console.error('[Google Sheets queue] ปลด lease ขัดข้อง:', error);
  }
}

export async function withGoogleSheetsWriteLease<T>(
  work: (supabase: any) => Promise<T>,
): Promise<{ acquired: boolean; value?: T }> {
  const supabase = getServiceSupabase();
  const token = randomUUID();
  const { data: acquired, error } = await supabase.rpc('try_acquire_sheet_write_lock', { p_token: token });
  if (error) throw error;
  if (!acquired) return { acquired: false };

  try {
    return { acquired: true, value: await work(supabase) };
  } finally {
    await releaseWriteLease(supabase, token);
  }
}

export async function flushGoogleSheetsSyncQueueLocked(
  supabase: any,
  limit = 100,
): Promise<GoogleSheetsSyncResult> {
  const { data: jobs, error: jobsError } = await supabase
    .from('google_sheets_sync_queue')
    .select('document_recipient_id, revision, attempts')
    .order('queued_at')
    .limit(limit);
  if (jobsError) throw jobsError;
  if (!jobs || jobs.length === 0) return { processed: 0, deferred: false, failed: 0 };

  const rows = await loadSheetRows(supabase, jobs);
  const foundRecipientIds = new Set(rows.map((row) => row.documentRecipientId));
  let processed = 0;
  let failed = 0;

  for (const job of jobs as QueueJob[]) {
    if (foundRecipientIds.has(job.document_recipient_id)) continue;
    const { error } = await supabase
      .from('google_sheets_sync_queue')
      .delete()
      .eq('document_recipient_id', job.document_recipient_id)
      .eq('revision', job.revision);
    if (error) throw error;
    processed += 1;
  }

  for (const row of rows) {
    try {
      const location = await findRowLocation(21, row.documentRecipientId);
      if (location) {
        await updateRowInSheetOrThrow(location.sheet, location.row, row.values);
      } else {
        await appendRowsOrThrow(row.sheetName, [row.values]);
      }
      // revision ทำให้คำสั่ง delete ไม่กลืนงานรุ่นใหม่ที่ถูก enqueue ระหว่างรอ Google
      const { error } = await supabase
        .from('google_sheets_sync_queue')
        .delete()
        .eq('document_recipient_id', row.documentRecipientId)
        .eq('revision', row.revision);
      if (error) throw error;
      processed += 1;
    } catch (error: any) {
      failed += 1;
      console.error(`[Google Sheets queue] ซิงก์ ${row.documentRecipientId} ไม่สำเร็จ:`, error);
      const job = (jobs as QueueJob[]).find((item) => item.document_recipient_id === row.documentRecipientId);
      const { error: queueError } = await supabase
        .from('google_sheets_sync_queue')
        .update({
          attempts: Number(job?.attempts || 0) + 1,
          last_error: String(error?.message || error).slice(0, 1000),
          last_attempt_at: new Date().toISOString(),
        })
        .eq('document_recipient_id', row.documentRecipientId)
        .eq('revision', row.revision);
      if (queueError) throw queueError;
    }
  }

  return { processed, deferred: false, failed };
}

/**
 * ส่งงานที่ trigger ในฐานข้อมูลบันทึกไว้ไป Google Sheets หนึ่งก้อน
 * ถ้ามีงานซ่อม/เขียนจาก instance อื่นอยู่ จะคืน deferred โดยไม่ทิ้งงานในคิว.
 */
export async function flushGoogleSheetsSyncQueue(limit = 100): Promise<GoogleSheetsSyncResult> {
  const lease = await withGoogleSheetsWriteLease((supabase) => flushGoogleSheetsSyncQueueLocked(supabase, limit));
  return lease.acquired ? lease.value! : { processed: 0, deferred: true, failed: 0 };
}
