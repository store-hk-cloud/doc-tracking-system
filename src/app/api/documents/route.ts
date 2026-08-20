import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { appendRow } from '@/lib/google-sheets';
import { requireRoles } from '@/lib/supabase/auth-helpers';
import { accountingDestinationFor, canViewGoodsReceiptWorkflow, GOODS_RECEIPT_SUBJECT, isGoodsReceipt } from '@/lib/document-workflow';

// A "document" returned to the client is a document_recipients row flattened
// with its parent document's shared fields (see migration 006). A document
// linked to N departments therefore appears as N separate rows here, one per
// department, each with its own independent status/signatures.
export async function GET(request: NextRequest) {
  try {
    const auth = await requireRoles(['super_admin', 'admin', 'user']);
    if (auth.response) return auth.response;

    const supabase = getServiceSupabase();
    const { searchParams } = new URL(request.url);
    const statuses = searchParams.getAll('status');
    const dept_id = searchParams.get('dept_id');
    const scope = searchParams.get('scope');
    const keyword = searchParams.get('keyword');
    const date_from = searchParams.get('date_from');
    const date_to = searchParams.get('date_to');
    const limit = parseInt(searchParams.get('limit') || '0', 10);

    // Phase 1: filter on shared document-level fields.
    let docQuery = supabase.from('documents').select('*');
    if (keyword) {
      docQuery = docQuery.or(`sender.ilike.%${keyword}%,subject.ilike.%${keyword}%,doc_number.ilike.%${keyword}%,tax_invoice_no.ilike.%${keyword}%`);
    }
    if (date_from) docQuery = docQuery.gte('received_date', date_from);
    if (date_to) docQuery = docQuery.lte('received_date', date_to);

    const { data: docs, error: docsError } = await docQuery;
    if (docsError) throw docsError;
    const docMap = new Map((docs || []).map((d: any) => [d.id, d]));
    if (docMap.size === 0) return NextResponse.json({ success: true, data: [] });

    // Phase 2: filter per-department recipient rows, scoped to the matched documents.
    let recQuery = supabase
      .from('document_recipients')
      .select('*')
      .in('document_id', Array.from(docMap.keys()));

    // scope=mine (used by the delivery page) shows documents the user themself
    // registered, across all departments — not the usual own-department filter.
    const isMineScope = scope === 'mine' && auth.context?.profile.role === 'user';
    if (statuses.length === 1) recQuery = recQuery.eq('status', statuses[0]);
    else if (statuses.length > 1) recQuery = recQuery.in('status', statuses);
    if (dept_id) recQuery = recQuery.eq('department_id', dept_id);

    const { data: recipientsData, error: recError } = await recQuery;
    if (recError) throw recError;

    let rows = recipientsData || [];
    if (isMineScope) {
      rows = rows.filter((r: any) => docMap.get(r.document_id)?.recorded_by === auth.context!.user.id);
    } else if (auth.context?.profile.role === 'user') {
      // ใบรับสินค้าเป็น routing กลางหนึ่งชุด: หน่วยงานที่เลือกประกอบเอกสาร
      // ไม่ได้เป็นปลายทางงาน จึงมองเห็นได้เฉพาะผู้ที่ถึงคิวของตนจริง.
      rows = rows.filter((r: any) => {
        const doc = docMap.get(r.document_id);
        if (isGoodsReceipt(doc?.subject)) {
          return canViewGoodsReceiptWorkflow(auth.context!.profile.department_code, r.status);
        }
        return r.department_id === auth.context!.profile.department_id;
      });
    }
    rows.sort((a: any, b: any) => (docMap.get(b.document_id)?.running_no || 0) - (docMap.get(a.document_id)?.running_no || 0));
    if (limit > 0) rows = rows.slice(0, limit);

    const deptIds = [...new Set(rows.map((r: any) => r.department_id).filter(Boolean))];
    const profileIds = [...new Set(rows.map((r: any) => docMap.get(r.document_id)?.recorded_by).filter(Boolean))];
    const recIds = rows.map((r: any) => r.id);

    const [{ data: departments }, { data: profiles }, { data: deliveries }] = await Promise.all([
      supabase.from('departments').select('id, name').in('id', deptIds.length ? deptIds : ['none']),
      supabase.from('profiles').select('id, full_name').in('id', profileIds.length ? profileIds : ['none']),
      supabase
        .from('delivery_logs')
        .select('id, document_recipient_id, recipient_signature, recipient_signed_at, is_verified, verified_by_admin')
        .in('document_recipient_id', recIds.length ? recIds : ['none'])
        .order('created_at', { ascending: false }),
    ]);

    const deptMap = new Map((departments || []).map((d: any) => [d.id, d.name]));
    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name]));
    // delivery_logs is ordered newest-first, so the first entry per recipient row wins (latest attempt).
    const recipientSignatureMap = new Map<string, { id: string; signature: string; signedAt: string; isVerified: boolean; verifiedByAdmin: boolean }>();
    for (const log of deliveries || []) {
      if (!recipientSignatureMap.has(log.document_recipient_id)) {
        recipientSignatureMap.set(log.document_recipient_id, {
          id: log.id,
          signature: log.recipient_signature,
          signedAt: log.recipient_signed_at,
          isVerified: log.is_verified,
          verifiedByAdmin: log.verified_by_admin,
        });
      }
    }

    const mapped = rows.map((r: any) => {
      const doc = docMap.get(r.document_id) || {};
      const sig = recipientSignatureMap.get(r.id);
      return {
        ...doc,
        id: r.id,
        document_id: r.document_id,
        recipient_dept_id: r.department_id,
        recipient_dept_name: deptMap.get(r.department_id) || null,
        status: r.status,
        admin_signature: r.admin_signature,
        admin_signed_at: r.admin_signed_at,
        inspector_signature: r.inspector_signature,
        inspector_signed_by: r.inspector_signed_by,
        inspector_signed_at: r.inspector_signed_at,
        purchasing_signature: r.purchasing_signature,
        purchasing_signed_by: r.purchasing_signed_by,
        purchasing_signed_at: r.purchasing_signed_at,
        recorded_by_name: profileMap.get(doc.recorded_by) || null,
        recipient_signature: sig?.signature || null,
        recipient_signed_at: sig?.signedAt || null,
        delivery_log_id: sig?.id || null,
        recipient_verified: sig?.isVerified ?? null,
        recipient_verified_by_admin: sig?.verifiedByAdmin ?? null,
      };
    });

    return NextResponse.json({ success: true, data: mapped });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRoles(['super_admin', 'admin', 'user']);
    if (auth.response) return auth.response;

    const supabase = getServiceSupabase();
    const body = await request.json();

    const subject = String(body.subject || '').trim();
    const requestedDeptIds: string[] = Array.isArray(body.recipient_dept_ids)
      ? [...new Set(body.recipient_dept_ids.filter(Boolean))]
      : [];
    // หน่วยงานบัญชีปลายทางต่างกันตามประเภทเอกสาร (ใบเบิก → 0-ADM03-1,
    // ใบรับสินค้า → 0-ADM03) จึงต้องอ่านจากแผนที่ ไม่ใช่ค่าคงที่ตัวเดียว
    const accountingDeptCode = accountingDestinationFor(subject);
    let deptIds = requestedDeptIds;

    if (!body.sender || !subject || (!accountingDeptCode && deptIds.length === 0)) {
      return NextResponse.json({ success: false, error: 'sender, subject and recipient_dept_ids (at least 1) are required' }, { status: 400 });
    }

    if (accountingDeptCode) {
      const { data: accountingDepartment, error: accountingError } = await supabase
        .from('departments')
        .select('id')
        .eq('code', accountingDeptCode)
        .maybeSingle();
      if (accountingError) throw accountingError;
      if (!accountingDepartment) {
        return NextResponse.json(
          { success: false, error: `ไม่พบหน่วยงานบัญชี (${accountingDeptCode}) สำหรับเอกสารประเภทนี้` },
          { status: 422 }
        );
      }
      // วางฝ่ายบัญชีไว้ลำดับแรกเพื่อคงความหมายของ recipient_dept_id แบบเดิมว่าเป็น
      // ปลายทางหลัก ขณะที่ document_recipients เก็บปลายทางเพิ่มเติมได้ครบถ้วน
      deptIds = [
        accountingDepartment.id,
        ...requestedDeptIds.filter((departmentId) => departmentId !== accountingDepartment.id),
      ];
    }

    // ใบรับสินค้าใช้ ACC/บัญชีเป็น document_recipient เพียงรายการเดียว
    // ส่วนหน่วยงานที่ผู้ใช้เลือกเพิ่มเก็บเป็น metadata ไม่สร้างงานหรือสิทธิ์เซ็น.
    const workflowRecipientDeptIds = subject === GOODS_RECEIPT_SUBJECT
      ? deptIds.slice(0, 1)
      : deptIds;

    const { data: doc, error: docError } = await supabase
      .from('documents')
      .insert({
        received_date: body.received_date || new Date().toISOString().split('T')[0],
        doc_number: body.doc_number || null,
        tax_invoice_no: body.tax_invoice_no || null,
        sender: body.sender,
        subject,
        note: body.note || null,
        is_damaged: body.is_damaged || false,
        damage_image_url: body.damage_image_url || null,
        recorded_by: auth.context!.user.id,
        // Legacy single-recipient columns are left unset going forward;
        // document_recipients is now the source of truth for status/dept/signatures.
        recipient_dept_id: workflowRecipientDeptIds[0],
      })
      .select()
      .single();
    if (docError) throw docError;

    const { data: recipients, error: recError } = await supabase
      .from('document_recipients')
      .insert(workflowRecipientDeptIds.map((department_id) => ({ document_id: doc.id, department_id, status: 'registered' })))
      .select();
    if (recError) throw recError;

    if (subject === GOODS_RECEIPT_SUBJECT && deptIds.length > 0) {
      const { error: tagsError } = await supabase
        .from('document_department_tags')
        .insert(deptIds.map((department_id) => ({ document_id: doc.id, department_id })));
      if (tagsError) throw tagsError;
    }

    let profName = '';
    if (doc.recorded_by) {
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', doc.recorded_by).single();
      profName = prof?.full_name || '';
    }
    const { data: depts } = await supabase.from('departments').select('id, name').in('id', deptIds);
    const deptNameMap = new Map((depts || []).map((d: any) => [d.id, d.name]));

    // Sync to Google Sheets: one row per recipient department.
    for (const r of recipients || []) {
      await appendRow('เอกสารเข้า', [
        String(doc.running_no),            // A: Running No.
        doc.received_date,                 // B: วันที่รับ
        doc.doc_number || '',              // C: เลขที่เอกสาร
        doc.sender,                        // D: ผู้ส่ง
        doc.subject,                       // E: เรื่อง
        deptNameMap.get(r.department_id) || '', // F: หน่วยงาน
        'registered',                       // G: สถานะ
        '',                                 // H: ลายเซ็น Admin
        '',                                 // I: เวลา Admin ลงนาม
        '',                                 // J: ชื่อผู้รับ
        '',                                 // K: ลายเซ็นผู้รับ
        '',                                 // L: เวลาผู้รับลงนาม
        '',                                 // M: ผลการตรวจสอบ
        '',                                 // N: หมายเหตุ (ผู้รับ)
        doc.is_damaged ? 'ใช่' : 'ไม่',       // O: เสียหาย
        doc.damage_image_url || '',          // P: รูปความเสียหาย
        doc.note || '',                      // Q: หมายเหตุ
        profName,                            // R: ผู้บันทึก
        '',                                  // S: updated_at
        doc.tax_invoice_no || '',            // T: เลขใบกำกับภาษี
        r.id,                                // U: รหัสอ้างอิง (document_recipients.id)
      ]);
    }

    const primary = recipients?.[0];
    return NextResponse.json({
      success: true,
      data: {
        ...doc,
        id: primary?.id,
        document_id: doc.id,
        recipient_dept_id: primary?.department_id,
        recipient_dept_name: deptNameMap.get(primary?.department_id) || '',
        status: primary?.status,
        recorded_by_name: profName,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
