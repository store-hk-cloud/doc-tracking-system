export type QueueOrderScope = 'delivery' | 'stage';

export interface QueueOrderResult {
  ok: boolean;
  status: number;
  error?: string;
}

/**
 * ย้ายแถว fromId ไปอยู่ตำแหน่ง toIndex ของ "ลำดับย่อยของแถวที่จัดได้" แล้ววางกลับลงช่องเดิมของแถวที่จัดได้
 * แถวที่จัดไม่ได้อยู่ตำแหน่งเดิมเสมอ (ตรงกับ RPC ฝั่ง DB ที่สลับเฉพาะช่องของแถวที่ส่งไป)
 * คืน array เดิมถ้าไม่มีอะไรเปลี่ยน
 */
export function moveOrderable<T>(
  items: T[],
  getId: (item: T) => string,
  isOrderable: (item: T) => boolean,
  fromId: string,
  toIndex: number,
): T[] {
  const slots: number[] = [];
  items.forEach((item, i) => { if (isOrderable(item)) slots.push(i); });
  const sub = slots.map((i) => items[i]);
  const from = sub.findIndex((item) => getId(item) === fromId);
  if (from < 0) return items;
  const to = Math.max(0, Math.min(sub.length - 1, toIndex));
  if (to === from) return items;
  const [moved] = sub.splice(from, 1);
  sub.splice(to, 0, moved);
  const next = items.slice();
  slots.forEach((slot, i) => { next[slot] = sub[i]; });
  return next;
}

/**
 * ช่วงของ next ตั้งแต่ตำแหน่งแรกถึงสุดท้ายที่ต่างจาก base (เทียบเฉพาะ id ที่มีในทั้งสองฝั่ง)
 * นอกช่วงเหมือนเดิมเสมอ ชุด id ในช่วงจึงเท่ากันทั้งสองฝั่ง คืน [] ถ้าไม่มีอะไรเปลี่ยน
 */
export function changedSpan(base: string[], next: string[]): string[] {
  const inNext = new Set(next);
  const inBase = new Set(base);
  const a = base.filter((id) => inNext.has(id));
  const b = next.filter((id) => inBase.has(id));
  let first = 0;
  while (first < a.length && a[first] === b[first]) first++;
  if (first === a.length) return [];
  let last = a.length - 1;
  while (a[last] === b[last]) last--;
  return b.slice(first, last + 1);
}

/** หา index ของแถวที่ y อยู่ในช่วง (ถ้าอยู่เหนือสุด/ใต้สุดให้ปัดเป็นแถวแรก/แถวสุดท้าย) */
export function dropIndexFromY(rects: { top: number; bottom: number }[], y: number): number {
  if (rects.length === 0) return -1;
  for (let i = 0; i < rects.length; i++) {
    if (y < rects[i].bottom) return i;
  }
  return rects.length - 1;
}

export async function saveQueueOrder(scope: QueueOrderScope, ids: string[]): Promise<QueueOrderResult> {
  try {
    const res = await fetch('/api/documents/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, ids }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success) return { ok: true, status: res.status };
    return { ok: false, status: res.status, error: data?.error };
  } catch (e) {
    return { ok: false, status: 0, error: (e as { message?: string } | null)?.message };
  }
}
