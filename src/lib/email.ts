/**
 * ส่งอีเมลแจ้งเตือน
 *
 * โปรเจกต์นี้ยังไม่มีผู้ให้บริการอีเมล ไฟล์นี้จึงออกแบบให้:
 *   - ใช้ Resend ถ้าตั้ง RESEND_API_KEY ไว้ (ไม่ต้องลงไลบรารีเพิ่ม เรียก REST ตรง)
 *   - ถ้ายังไม่ตั้งคีย์ จะ **ไม่ throw** แต่คืนสถานะ skipped พร้อมเหตุผล
 *     และ log ไว้ เพื่อให้ cron ทำงานได้ตั้งแต่วันแรกโดยไม่ล้ม และเห็นว่า
 *     "ถ้ามีคีย์แล้วจะส่งหาใครบ้าง" ก่อนเปิดใช้จริง
 *
 * เหตุผลที่เลือกเรียก REST ตรงแทนการลง SDK: ลด dependency และทำให้เปลี่ยน
 * ผู้ให้บริการภายหลังแตะแค่ไฟล์นี้ไฟล์เดียว
 */

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; error: string };

export type Mail = {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  text: string;
};

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export async function sendEmail(mail: Mail): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'ระบบเอกสาร <onboarding@resend.dev>';

  const recipients = mail.to.filter(Boolean);
  if (recipients.length === 0) {
    return { ok: false, skipped: true, reason: 'ไม่มีอีเมลผู้รับ' };
  }

  if (!apiKey) {
    console.log(
      `[Email] ยังไม่ได้ตั้ง RESEND_API_KEY — ข้ามการส่ง: "${mail.subject}" -> ${recipients.join(', ')}`
    );
    return { ok: false, skipped: true, reason: 'ยังไม่ได้ตั้งค่า RESEND_API_KEY' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: recipients,
        cc: mail.cc?.filter(Boolean),
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, skipped: false, error: `${res.status} ${body.slice(0, 200)}` };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, id: data?.id ?? null };
  } catch (e: any) {
    return { ok: false, skipped: false, error: e?.message || 'ส่งอีเมลไม่สำเร็จ' };
  }
}

/** อีเมลที่ระบบสังเคราะห์ให้บัญชีชื่อผู้ใช้ ส่งจริงไม่ได้ ต้องกรองออกก่อนส่ง */
export function isRealEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  if (email.endsWith('@msg.hillkoff.local')) return false;
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email);
}
