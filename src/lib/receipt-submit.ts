type ReceiptInput = {
  document_recipient_id: string;
  is_verified: boolean;
  recipient_signature: string;
  verification_note: string | null;
};

export async function submitReceipt(input: ReceiptInput, actorId?: string, recipientUpdatedAt?: string): Promise<Response> {
  const payload = { ...input, recipient_signature: input.recipient_signature.trim() };
  let response: Response | undefined;
  let data: any;
  try {
    response = await fetch('/api/deliveries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok && ![502, 503, 504].includes(response.status)) return response;
    try {
      data = await response.clone().json();
      if (![502, 503, 504].includes(response.status)) return response;
    } catch {
      // Proxy อาจส่ง HTML กลับหลังฐานข้อมูลบันทึกแล้ว ต้องตรวจหลักฐานก่อนแจ้งให้ลองใหม่
    }
  } catch {
    // การเชื่อมต่อขาดไม่ได้ยืนยันว่า transaction ล้มเหลว
  }

  const baseline = recipientUpdatedAt ? Date.parse(recipientUpdatedAt) : NaN;
  if (actorId && Number.isFinite(baseline)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const readback = await fetch(`/api/deliveries?document_recipient_id=${encodeURIComponent(payload.document_recipient_id)}`, {
        method: 'GET', cache: 'no-store', signal: controller.signal,
      });
      const result = await readback.json();
      const latest = result.success && Array.isArray(result.data) ? result.data[0] : null;
      const signedAt = latest?.recipient_signed_at ? Date.parse(latest.recipient_signed_at) : NaN;
      if (readback.ok && latest
        && latest.document_recipient_id === payload.document_recipient_id
        && latest.document_recipients?.id === payload.document_recipient_id
        && latest.document_recipients.status === (payload.is_verified ? 'closed' : 'rejected')
        && latest.recipient_id === actorId
        && latest.recipient_signature === payload.recipient_signature
        && latest.is_verified === payload.is_verified
        && (latest.verification_note || null) === (payload.verification_note || null)
        && Number.isFinite(signedAt) && signedAt > baseline) {
        return Response.json({ success: true, data: latest });
      }
    } catch {
      // ถ้าอ่านหลักฐานไม่ได้ ต้องคงความไม่แน่นอนและไม่ส่ง POST ซ้ำอัตโนมัติ
    } finally {
      clearTimeout(timeout);
    }
  }
  return Response.json({
    success: false,
    error: `${data?.error || 'ยังยืนยันผลการรับเอกสารไม่ได้'} กรุณาโหลดข้อมูลล่าสุดก่อนลองใหม่`,
  }, { status: response?.ok ? 502 : response?.status || 503 });
}
