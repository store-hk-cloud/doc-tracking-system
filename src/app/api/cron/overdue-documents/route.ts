import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { isRealEmail, sendEmail } from '@/lib/email';

/**
 * GET /api/cron/overdue-documents — แจ้งเตือนต้นทางเมื่อเอกสารค้างไม่มีผู้กดรับ
 *
 * นิยาม "ค้าง": document_recipients ที่สถานะยังเป็น 'delivered' (ส่งมอบแล้ว
 * แต่ปลายทางยังไม่กดรับ) นานเกินเกณฑ์ที่ตั้งไว้ใน app_settings.overdue_alert_hours
 * (ค่าเริ่มต้น 24 ชั่วโมง) นับจากเวลาที่ส่งมอบ (admin_signed_at)
 *
 * "ต้นทาง" = ผู้บันทึกเอกสาร (documents.recorded_by) เป็นหลัก
 * เพราะเป็นคนที่รู้ว่าเอกสารฉบับนั้นสำคัญแค่ไหนและตามเรื่องต่อได้
 *
 * กันส่งซ้ำด้วยตาราง document_overdue_alerts ที่ unique (recipient, threshold)
 * แต่ละฉบับจึงได้เมลระดับ 24 ชม. แค่ครั้งเดียวไม่ว่า cron จะรันกี่รอบ
 *
 * ตารางเวลา: วันละครั้ง 08:00 น. เวลาไทย (01:00 UTC) เพราะแผน Vercel Hobby
 * จำกัด cron ไว้วันละครั้ง ผลคือเอกสารที่เพิ่งเกิน 24 ชม. หลังรอบเช้าจะได้เมล
 * เช้าวันถัดไป (ช้าได้สูงสุดราว 23 ชม.) ถ้าต้องการเตือนไวกว่านี้ต้องขึ้นแผน Pro
 * แล้วเปลี่ยน schedule ใน vercel.json เป็นรายชั่วโมง
 *
 * ความปลอดภัย: Vercel Cron ส่ง header Authorization: Bearer $CRON_SECRET
 * ถ้าตั้ง CRON_SECRET ไว้ route นี้จะรับเฉพาะคำขอที่มี secret ตรงกัน
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = request.headers.get('authorization');
    if (header !== `Bearer ${secret}`) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const supabase = getServiceSupabase();

    const { data: settings } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', ['overdue_alert_hours', 'overdue_alert_cc']);
    const settingMap = new Map((settings || []).map((s: any) => [s.key, s.value]));
    const hours = Math.max(1, Number(settingMap.get('overdue_alert_hours')) || 24);
    const cc = String(settingMap.get('overdue_alert_cc') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(isRealEmail);

    const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();

    // เอกสารที่ส่งมอบแล้วแต่ยังไม่มีใครกดรับ และเลยกำหนดแล้ว
    // เรียงจากค้างนานสุดก่อน เพื่อให้ถ้าชน LIMIT ฉบับที่ค้างนานที่สุดได้เตือนก่อน
    const LIMIT = 1000;
    const { data: overdue, error } = await supabase
      .from('document_recipients')
      .select('id, department_id, admin_signed_at, status, documents!inner(*)')
      .eq('status', 'delivered')
      .not('admin_signed_at', 'is', null)
      .lte('admin_signed_at', cutoff)
      .order('admin_signed_at', { ascending: true })
      .limit(LIMIT);
    if (error) throw error;
    // ถ้าชนเพดานแปลว่ายังมีตกค้างที่ยังไม่ได้ตรวจในรอบนี้ ต้องเห็นใน log
    // ไม่ใช่เงียบหายไปเหมือนไม่มีอะไรค้าง
    const truncated = (overdue || []).length >= LIMIT;
    if (truncated) {
      console.warn(`[Cron overdue-documents] ชนเพดาน ${LIMIT} แถว ยังมีเอกสารค้างที่ยังไม่ได้ตรวจในรอบนี้`);
    }

    const rows = (overdue || []) as any[];
    if (rows.length === 0) {
      return NextResponse.json({ success: true, data: { checked: 0, sent: 0, skipped: 0 } });
    }

    // ตัดฉบับที่เคยเตือนระดับนี้ไปแล้วออก
    const { data: alreadySent } = await supabase
      .from('document_overdue_alerts')
      .select('document_recipient_id')
      .eq('threshold_hours', hours)
      .in('document_recipient_id', rows.map((r) => r.id));
    const sentSet = new Set((alreadySent || []).map((a: any) => a.document_recipient_id));
    const pending = rows.filter((r) => !sentSet.has(r.id));

    if (pending.length === 0) {
      return NextResponse.json({
        success: true,
        data: { checked: rows.length, sent: 0, skipped: 0, note: 'เตือนไปแล้วทุกฉบับ' },
      });
    }

    // ผู้รับเมล = ผู้บันทึกเอกสาร (ต้นทาง) + ชื่อแผนกปลายทางไว้บอกในเนื้อเมล
    const recorderIds = [...new Set(pending.map((r) => r.documents?.recorded_by).filter(Boolean))];
    const deptIds = [...new Set(pending.map((r) => r.department_id).filter(Boolean))];
    const [{ data: recorders }, { data: depts }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email').in('id', recorderIds.length ? recorderIds : ['none']),
      supabase.from('departments').select('id, name').in('id', deptIds.length ? deptIds : ['none']),
    ]);
    const recorderMap = new Map((recorders || []).map((p: any) => [p.id, p]));
    const deptMap = new Map((depts || []).map((d: any) => [d.id, d.name]));

    // รวมเอกสารของต้นทางคนเดียวกันเป็นเมลฉบับเดียว — ไม่ยิงทีละใบให้รำคาญ
    const byRecorder = new Map<string, any[]>();
    for (const row of pending) {
      const key = row.documents?.recorded_by || 'unknown';
      if (!byRecorder.has(key)) byRecorder.set(key, []);
      byRecorder.get(key)!.push(row);
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    let sent = 0;
    let skipped = 0;
    let notConfigured = false;
    const results: any[] = [];

    for (const [recorderId, items] of byRecorder) {
      const recorder = recorderMap.get(recorderId);
      const to = isRealEmail(recorder?.email) ? [recorder.email] : [];

      const lines = items.map((r) => {
        const d = r.documents;
        const deptName = deptMap.get(r.department_id) || 'ไม่ระบุหน่วยงาน';
        const waited = Math.floor((Date.now() - new Date(r.admin_signed_at).getTime()) / 3_600_000);
        return {
          text: `- เลขที่ ${d.running_no} | ${d.subject} | จาก ${d.sender} | ปลายทาง ${deptName} | ค้าง ${waited} ชม.`,
          html: `<tr>
            <td style="padding:6px 10px;border:1px solid #ddd">${d.running_no}</td>
            <td style="padding:6px 10px;border:1px solid #ddd">${escapeHtml(d.subject)}</td>
            <td style="padding:6px 10px;border:1px solid #ddd">${escapeHtml(d.sender)}</td>
            <td style="padding:6px 10px;border:1px solid #ddd">${escapeHtml(deptName)}</td>
            <td style="padding:6px 10px;border:1px solid #ddd;text-align:right">${waited} ชม.</td>
          </tr>`,
        };
      });

      const subject = `[แจ้งเตือน] เอกสาร ${items.length} ฉบับยังไม่มีผู้กดรับ เกิน ${hours} ชั่วโมง`;
      const text = [
        `เอกสารที่คุณบันทึกไว้ ${items.length} ฉบับ ถูกส่งมอบแล้วแต่ปลายทางยังไม่กดรับ เกิน ${hours} ชั่วโมง`,
        '',
        ...lines.map((l) => l.text),
        '',
        appUrl ? `ตรวจสอบได้ที่ ${appUrl}/tracking` : '',
        'อีเมลนี้ส่งอัตโนมัติจากระบบจดหมาย พัสดุ เอกสารภายใน',
      ].join('\n');

      const html = `
        <div style="font-family:sans-serif;font-size:14px;color:#1c1c1e">
          <p>เอกสารที่คุณบันทึกไว้ <strong>${items.length} ฉบับ</strong> ถูกส่งมอบแล้วแต่ปลายทางยังไม่กดรับ เกิน <strong>${hours} ชั่วโมง</strong></p>
          <table style="border-collapse:collapse;font-size:13px">
            <thead><tr>
              <th style="padding:6px 10px;border:1px solid #ddd">เลขที่</th>
              <th style="padding:6px 10px;border:1px solid #ddd">เรื่อง</th>
              <th style="padding:6px 10px;border:1px solid #ddd">ผู้ส่ง</th>
              <th style="padding:6px 10px;border:1px solid #ddd">ปลายทาง</th>
              <th style="padding:6px 10px;border:1px solid #ddd">ค้าง</th>
            </tr></thead>
            <tbody>${lines.map((l) => l.html).join('')}</tbody>
          </table>
          ${appUrl ? `<p><a href="${appUrl}/tracking">เปิดหน้าติดตามเอกสาร</a></p>` : ''}
          <p style="color:#6b7280;font-size:12px">อีเมลนี้ส่งอัตโนมัติจากระบบจดหมาย พัสดุ เอกสารภายใน</p>
        </div>`;

      const result = await sendEmail({ to, cc, subject, html, text });

      // บันทึกกันส่งซ้ำ **เฉพาะเมื่อได้ลองส่งจริงแล้ว** เท่านั้น
      //
      // สำคัญ: ถ้าบันทึกตอนที่ยังไม่ได้ตั้งค่าอีเมล เอกสารชุดนั้นจะถูกทำเครื่องหมาย
      // ว่า "เตือนแล้ว" ตลอดกาล พอตั้งคีย์จริงในภายหลังก็จะไม่มีใครได้รับเมลเลย
      // ซึ่งเป็นความล้มเหลวแบบเงียบที่แย่กว่าการส่งซ้ำ
      const attempted = result.ok || !('skipped' in result && result.skipped);
      if (attempted) {
        const rowsToInsert = items.map((r) => ({
          document_recipient_id: r.id,
          threshold_hours: hours,
          sent_to: to.join(',') || '(ไม่มีอีเมลผู้รับ)',
          delivered: result.ok,
          error: result.ok ? null : (result as any).error,
        }));
        await supabase.from('document_overdue_alerts').insert(rowsToInsert);
      }

      if (result.ok) sent += items.length;
      else skipped += items.length;
      if (!attempted) notConfigured = true;
      results.push({
        recorder: recorder?.full_name || recorderId,
        to,
        count: items.length,
        result,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        threshold_hours: hours,
        checked: rows.length,
        sent,
        skipped,
        // ไม่ได้ตั้งค่าอีเมล = ยังไม่ได้บันทึกกันซ้ำ รอบหน้าจะลองใหม่ทั้งหมด
        email_configured: !notConfigured,
        truncated,
        results,
      },
    });
  } catch (error: any) {
    console.error('[Cron overdue-documents] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
