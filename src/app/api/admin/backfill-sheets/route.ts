import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { requireRoles } from '@/lib/supabase/auth-helpers';
import { listSheetTabs, getSheetValues, batchUpdateRows } from '@/lib/google-sheets';

// One-time/repeatable maintenance endpoint: historical Google Sheets rows created
// before the multi-department refactor have no value in column U (รหัสอ้างอิง), so
// later updates (sign/deliveries/redeliver/verify) can no longer find them via
// findRowLocation and silently stop syncing. This scans every sheet tab, matches
// blank-U rows back to their document_recipients row by running_no, and rewrites
// them with current data plus the missing reference id.
export async function GET() {
  try {
    const auth = await requireRoles(['super_admin']);
    if (auth.response) return auth.response;

    const supabase = getServiceSupabase();
    const tabs = await listSheetTabs();

    const pending: { sheet: string; row: number; runningNo: string }[] = [];
    for (const sheet of tabs) {
      const rows = await getSheetValues(sheet);
      for (let i = 1; i < rows.length; i++) {
        const runningNo = rows[i][0];
        const ref = rows[i][20];
        if (runningNo && !ref) {
          pending.push({ sheet, row: i + 1, runningNo: String(runningNo) });
        }
      }
    }

    if (pending.length === 0) {
      return NextResponse.json({ success: true, tabsScanned: tabs.length, updated: 0, skipped: 0, message: 'ไม่มีแถวเก่าที่ต้องอัปเดต' });
    }

    const runningNos = [...new Set(pending.map((p) => p.runningNo))];
    const { data: docs } = await supabase.from('documents').select('*').in('running_no', runningNos);
    const docByRunningNo = new Map((docs || []).map((d: any) => [String(d.running_no), d]));
    const docIds = (docs || []).map((d: any) => d.id);

    const { data: recipients } = await supabase
      .from('document_recipients')
      .select('*')
      .in('document_id', docIds.length ? docIds : ['none']);
    const recipientsByDoc = new Map<string, any[]>();
    for (const r of recipients || []) {
      const list = recipientsByDoc.get(r.document_id) || [];
      list.push(r);
      recipientsByDoc.set(r.document_id, list);
    }

    const deptIds = [...new Set((recipients || []).map((r: any) => r.department_id).filter(Boolean))];
    const profileIds = [...new Set((docs || []).map((d: any) => d.recorded_by).filter(Boolean))];
    const recipientIds = (recipients || []).map((r: any) => r.id);

    const [{ data: departments }, { data: profiles }, { data: deliveries }] = await Promise.all([
      supabase.from('departments').select('id, name').in('id', deptIds.length ? deptIds : ['none']),
      supabase.from('profiles').select('id, full_name').in('id', profileIds.length ? profileIds : ['none']),
      supabase
        .from('delivery_logs')
        .select('*')
        .in('document_recipient_id', recipientIds.length ? recipientIds : ['none'])
        .order('created_at', { ascending: false }),
    ]);
    const deptMap = new Map((departments || []).map((d: any) => [d.id, d.name]));
    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name]));
    const deliveryByRecipient = new Map<string, any>();
    for (const log of deliveries || []) {
      if (!deliveryByRecipient.has(log.document_recipient_id)) deliveryByRecipient.set(log.document_recipient_id, log);
    }

    const bySheet = new Map<string, { row: number; values: string[] }[]>();
    let updated = 0;
    let skipped = 0;

    for (const p of pending) {
      const doc = docByRunningNo.get(p.runningNo);
      const recs = doc ? recipientsByDoc.get(doc.id) || [] : [];
      // Only handle the unambiguous legacy case: exactly one recipient per document.
      // Rows for documents with >1 recipient are new enough to already carry a
      // reference id, so this should only ever skip genuinely orphaned rows.
      if (!doc || recs.length !== 1) {
        skipped++;
        continue;
      }
      const r = recs[0];
      const delivery = deliveryByRecipient.get(r.id);
      const profName = profileMap.get(doc.recorded_by) || '';
      const values = [
        String(doc.running_no), doc.received_date, doc.doc_number || '',
        doc.sender, doc.subject, deptMap.get(r.department_id) || '',
        r.status, r.admin_signature || '', r.admin_signed_at || '',
        delivery?.recipient_signature || '', delivery?.recipient_signature || '', delivery?.recipient_signed_at || '',
        delivery ? (delivery.is_verified ? 'ถูกต้อง' : 'ไม่ถูกต้อง') : '', delivery?.verification_note || '',
        doc.is_damaged ? 'ใช่' : 'ไม่', doc.damage_image_url || '', doc.note || '',
        profName, r.updated_at, doc.tax_invoice_no || '', r.id,
      ];
      const list = bySheet.get(p.sheet) || [];
      list.push({ row: p.row, values });
      bySheet.set(p.sheet, list);
      updated++;
    }

    for (const [sheet, list] of bySheet) {
      await batchUpdateRows(sheet, list);
    }

    return NextResponse.json({ success: true, tabsScanned: tabs.length, updated, skipped });
  } catch (error: any) {
    console.error('[Backfill Sheets] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
