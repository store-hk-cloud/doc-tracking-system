/**
 * ตัวช่วยสำหรับหน้าจอที่ใช้งานภาคสนาม (มือถือ กลางแดด สัญญาณอ่อน)
 * ใช้ได้เฉพาะฝั่ง client
 */

/**
 * ย่อรูปก่อนอัปโหลด — นี่คือความต่างระหว่าง "อัปโหลดสำเร็จ" กับ "timeout"
 * กล้องมือถือ 12MP ให้ JPEG 4-6MB ต่อรูป บน 3G อาจใช้เวลา 60 วินาทีขึ้นไป
 * ย่อด้านยาวสุดเหลือ 1600px คุณภาพ 0.8 ได้ราว 300-500KB ซึ่งยังอ่านตัวเลข
 * บนสลิปได้ชัด
 */
export async function compressImage(
  file: File,
  maxEdge = 1600,
  quality = 0.8
): Promise<File> {
  if (!file.type.startsWith('image/')) return file;

  const bitmapUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('อ่านรูปไม่สำเร็จ'));
      el.src = bitmapUrl;
    });

    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    // รูปเล็กกว่าเพดานอยู่แล้ว ไม่ต้องเข้ารหัสใหม่ (จะทำให้คุณภาพแย่ลงเปล่า ๆ)
    if (scale >= 1 && file.size < 1_200_000) return file;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality)
    );
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } catch {
    // ย่อไม่ได้ก็ส่งไฟล์เดิม ดีกว่าบล็อกไม่ให้บันทึกงาน
    return file;
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}

export type GeoStamp = { lat: number; lng: number; accuracy: number } | null;

/** ขอพิกัด GPS แบบไม่บล็อกงาน — ถ้าไม่ได้ก็คืน null ให้กรอกงานต่อไปได้ */
export function getGeoStamp(timeoutMs = 8000): Promise<GeoStamp> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 }
    );
  });
}

/**
 * normalize ยอดเงินที่ผู้ใช้พิมพ์ ก่อนเทียบสองช่อง (double-entry)
 * ต้อง normalize ก่อนเทียบ ไม่งั้น "45,000" กับ "45000" จะถือว่าไม่ตรงกัน
 * การแปลงเป็นสตางค์จริงทำที่ server (src/lib/money.ts) เท่านั้น
 */
export function normalizeAmountInput(value: string): string {
  return value.trim().replace(/,/g, '').replace(/\s+/g, '');
}

export function amountsMatch(a: string, b: string): boolean {
  const na = normalizeAmountInput(a);
  const nb = normalizeAmountInput(b);
  if (!na || !nb) return false;
  // "45000" และ "45000.00" ถือว่าตรงกัน
  const pad = (s: string) => (s.includes('.') ? s.replace(/(\.\d)$/, '$10') : `${s}.00`);
  return pad(na) === pad(nb);
}

/** แสดงจำนวนเงินฝั่ง client (ไม่ใช้คำนวณ) */
export function formatBahtDisplay(value: string): string {
  const n = normalizeAmountInput(value);
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(n);
  if (!m) return value;
  const baht = Number(m[1]).toLocaleString('en-US');
  return `${baht}.${(m[2] || '').padEnd(2, '0')}`;
}

/** อัปโหลดรูปหลักฐานไปที่งานใบหนึ่ง คืน id ของรูปที่บันทึกไว้ */
export async function uploadJobPhoto(
  jobId: string,
  file: File,
  photoKind: 'payin_slip' | 'cash_envelope' | 'deposit_slip' | 'variance_doc' | 'other',
  geo?: GeoStamp,
  caption?: string
): Promise<{ id: string; view_link: string }> {
  const compressed = await compressImage(file);
  const form = new FormData();
  form.append('file', compressed);
  form.append('photo_kind', photoKind);
  if (caption) form.append('caption', caption);
  if (geo) {
    form.append('lat', String(geo.lat));
    form.append('lng', String(geo.lng));
    form.append('gps_accuracy_m', String(geo.accuracy));
  }
  const res = await fetch(`/api/messenger/runs/${jobId}/photos`, { method: 'POST', body: form });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'อัปโหลดรูปไม่สำเร็จ');
  return data.data;
}

// ── draft ในเครื่อง ──
// เขียน draft ก่อนแตะ network เสมอ ถ้าแอปถูก kill กลางทางยังกู้ได้
const DRAFT_PREFIX = 'cash-draft:';

export function saveDraft(key: string, value: unknown) {
  try {
    localStorage.setItem(`${DRAFT_PREFIX}${key}`, JSON.stringify(value));
  } catch {
    // โหมด private หรือ quota เต็ม — ไม่ใช่เหตุให้บล็อกการทำงาน
  }
}

export function loadDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`${DRAFT_PREFIX}${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function clearDraft(key: string) {
  try {
    localStorage.removeItem(`${DRAFT_PREFIX}${key}`);
  } catch {
    // ไม่มีอะไรต้องทำ
  }
}
