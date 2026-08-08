import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { requireRoles } from '@/lib/supabase/auth-helpers';
import { listSheetTabs, getSheetValues, batchUpdateRowsOrThrow, appendRowsOrThrow, getSpreadsheetUrl } from '@/lib/google-sheets';

// One-time/repeatable maintenance endpoint covering two kinds of drift between
// Supabase and Google Sheets:
//  1. Legacy rows that exist but predate the "รหัสอ้างอิง" column (U) — these get
//     updated in place once matched back to their document_recipients row.
//  2. Documents/recipients that never made it into Sheets at all (e.g. an append
//     silently failed) — these get appended fresh since there's no historical
//     row to place them "on" other than today's tab.
export async function GET() {
  try {
    const auth = await requireRoles(['super_admin']);
    if (auth.response) return auth.response;

    const supabase = getServiceSupabase();
    const tabs = await listSheetTabs();

    const refSet = new Set<string>();
    const runningNoRows = new Map<string, { sheet: string; row: number; hasRef: boolean }[]>();
    for (const sheet of tabs) {
      const rows = await getSheetValues(sheet);
      for (let i = 1; i < rows.length; i++) {
        const runningNo = rows[i][0];
        const ref = rows[i][20];
        if (ref) refSet.add(String(ref));
        if (runningNo) {
          const list = runningNoRows.get(String(runningNo)) || [];
          list.push({ sheet, row: i + 1, hasRef: !!ref });
          runningNoRows.set(String(runningNo), list);
        }
      }
    }

    const { data: docs } = await supabase.from('documents').select('*');
    const { data: recipients } = await supabase.from('document_recipients').select('*');
    const docById = new Map((docs || []).map((d: any) => [d.id, d]));

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

    const buildValues = (doc: any, r: any) => {
      const delivery = deliveryByRecipient.get(r.id);
      const profName = profileMap.get(doc.recorded_by) || '';
      return [
        String(doc.running_no), doc.received_date, doc.doc_number || '',
        doc.sender, doc.subject, deptMap.get(r.department_id) || '',
        r.status, r.admin_signature || '', r.admin_signed_at || '',
        delivery?.recipient_signature || '', delivery?.recipient_signature || '', delivery?.recipient_signed_at || '',
        delivery ? (delivery.is_verified ? 'ถูกต้อง' : 'ไม่ถูกต้อง') : '', delivery?.verification_note || '',
        doc.is_damaged ? 'ใช่' : 'ไม่', doc.damage_image_url || '', doc.note || '',
        profName, r.updated_at, doc.tax_invoice_no || '', r.id,
      ];
    };

    const bySheet = new Map<string, { row: number; values: string[] }[]>();
    const toAppend: string[][] = [];

    for (const r of recipients || []) {
      if (refSet.has(r.id)) continue; // already correctly synced somewhere

      const doc = docById.get(r.document_id);
      if (!doc) continue;

      const siblingRows = runningNoRows.get(String(doc.running_no)) || [];
      const recsForDoc = recipientsByDoc.get(r.document_id) || [];
      const reusableBlankRow = recsForDoc.length === 1 ? siblingRows.find((row) => !row.hasRef) : undefined;

      if (reusableBlankRow) {
        const list = bySheet.get(reusableBlankRow.sheet) || [];
        list.push({ row: reusableBlankRow.row, values: buildValues(doc, r) });
        bySheet.set(reusableBlankRow.sheet, list);
      } else {
        toAppend.push(buildValues(doc, r));
      }
    }

    // One API call per sheet tab needing updates, and one more for all appends
    // combined — looping a call per row is what blows through Sheets' quota.
    // Use the throwing variants here (unlike normal sign/deliver actions) so a
    // failed write surfaces as an error instead of silently reporting success.
    for (const [sheet, list] of bySheet) {
      await batchUpdateRowsOrThrow(sheet, list);
    }
    await appendRowsOrThrow('เอกสารเข้า', toAppend);

    const updated = [...bySheet.values()].reduce((sum, list) => sum + list.length, 0);
    const appended = toAppend.length;

    return NextResponse.json({
      success: true,
      spreadsheetUrl: await getSpreadsheetUrl(),
      tabsScanned: tabs.length,
      updated,
      appended,
      message: updated === 0 && appended === 0 ? 'ข้อมูลใน Sheets ครบถ้วนแล้ว ไม่มีอะไรต้องแก้' : undefined,
    });
  } catch (error: any) {
    console.error('[Backfill Sheets] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
