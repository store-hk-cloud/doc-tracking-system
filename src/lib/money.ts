/**
 * เงินในโมดูลนี้เก็บเป็น "สตางค์" (integer) เท่านั้น ห้ามใช้ float ทุกจุด
 *
 * ทำไมไม่ใช้ NUMERIC(12,2) ใน Postgres: โค้ดไม่ได้คำนวณใน Postgres แต่คำนวณใน
 * Node ผ่าน supabase-js และ PostgREST ส่ง `numeric` ออกมาเป็น JSON number
 * → `JSON.parse` แปลงเป็น IEEE-754 double ทันที ความแม่นยำที่ Postgres รักษาไว้
 * หายที่ขอบ HTTP ผลคือ 12500.10 - 12500.00 === 0.09999999999999432 ซึ่งจะทำให้
 * `variance > 0` เป็นจริงกับรายการที่ตรงเป๊ะ และไป trigger การล็อก "เงินเกิน"
 * แบบ false positive ในระบบที่เงินเกิน = สัญญาณทุจริต นั่นคือ bug ที่ทำลาย
 * ความน่าเชื่อถือของทั้งโมดูล
 *
 * BIGINT สตางค์: เพดาน 1e12 สตางค์ (หมื่นล้านบาท) ต่ำกว่า Number.MAX_SAFE_INTEGER
 * (9.007e15) ประมาณ 9,000 เท่า → จำนวนเต็มทุกค่าในช่วงนี้แทนด้วย double ได้
 * แม่นยำ 100% และการบวก/ลบก็แม่นยำ 100% ทำให้ `variance === 0` เชื่อถือได้จริง
 */

/** เพดานที่ระบบยอมรับ: 10,000,000,000.00 บาท ในหน่วยสตางค์ (ตรงกับ CHECK ใน DB) */
export const MAX_SATANG = 1_000_000_000_000;

export class MoneyParseError extends Error {}

/**
 * แปลงยอดบาทที่มาจาก client ให้เป็นสตางค์ (integer)
 *
 * ห้ามเขียน `Math.round(parseFloat(s) * 100)` เด็ดขาด — สำหรับ input ทศนิยม 2
 * ตำแหน่งบางค่า double ที่ได้จะต่ำกว่าค่าจริงเล็กน้อย แล้ว `* 100` ไปลงที่
 * x.4999999 ทำให้การปัดเศษกลายเป็นการโยนหัวก้อยที่สตางค์สุดท้าย ที่นี่จึง
 * parse สตริงทศนิยมทีละหลัก ไม่ให้ float แตะค่าเลย
 *
 * รับ: "12500", "12500.5", "12500.50", "12,500.50", " 12500.50 ", 12500
 * ปฏิเสธ: ค่าติดลบ, exponent ("1e5"), ทศนิยมเกิน 2 ตำแหน่ง, ค่าว่าง, null,
 *         อักขระอื่น และค่าที่เกิน MAX_SATANG
 */
export function parseBahtToSatang(input: unknown): number {
  let raw: string;

  if (typeof input === 'number') {
    // ค่านี้ผ่าน double มาแล้ว รับได้เฉพาะกรณีที่ยังปลอดภัยแน่นอน:
    // จำนวนเต็มในช่วง safe เท่านั้น ทศนิยมที่มาเป็น number เชื่อถือไม่ได้
    if (!Number.isFinite(input)) throw new MoneyParseError('จำนวนเงินไม่ถูกต้อง');
    if (!Number.isInteger(input)) {
      throw new MoneyParseError('กรุณาส่งจำนวนเงินเป็นข้อความ (string) เพื่อความแม่นยำของทศนิยม');
    }
    raw = String(input);
  } else if (typeof input === 'string') {
    raw = input;
  } else {
    throw new MoneyParseError('กรุณากรอกจำนวนเงิน');
  }

  // normalize: ตัดช่องว่างและคอมมาคั่นหลักพันที่ผู้ใช้พิมพ์/วางมา
  const cleaned = raw.trim().replace(/,/g, '').replace(/\s+/g, '');
  if (cleaned === '') throw new MoneyParseError('กรุณากรอกจำนวนเงิน');

  // ยอมรับเฉพาะเลขล้วน + จุดทศนิยมไม่เกิน 2 ตำแหน่ง ไม่มีเครื่องหมาย ไม่มี exponent
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) {
    throw new MoneyParseError('รูปแบบจำนวนเงินไม่ถูกต้อง (ตัวเลขและทศนิยมไม่เกิน 2 ตำแหน่ง)');
  }

  const bahtPart = match[1];
  const satangPart = (match[2] || '').padEnd(2, '0');

  // ประกอบเป็นสตริงจำนวนเต็มสตางค์ แล้วแปลงครั้งเดียว — ไม่มีการคูณ float
  const satangStr = `${bahtPart}${satangPart}`.replace(/^0+(?=\d)/, '');
  const satang = Number(satangStr);

  if (!Number.isSafeInteger(satang)) {
    throw new MoneyParseError('จำนวนเงินเกินช่วงที่ระบบรองรับ');
  }
  if (satang > MAX_SATANG) {
    throw new MoneyParseError(`จำนวนเงินเกินเพดานที่ระบบรองรับ (${formatSatangToBaht(MAX_SATANG)} บาท)`);
  }
  return satang;
}

/** แสดงสตางค์เป็นบาทแบบมีคอมมาและทศนิยม 2 ตำแหน่งเสมอ เช่น 4500000 -> "45,000.00" */
export function formatSatangToBaht(satang: number): string {
  const negative = satang < 0;
  const abs = Math.abs(Math.trunc(satang));
  const baht = Math.trunc(abs / 100);
  const rest = abs % 100;
  const bahtStr = baht.toLocaleString('en-US');
  const restStr = String(rest).padStart(2, '0');
  return `${negative ? '-' : ''}${bahtStr}.${restStr}`;
}

/** ค่าสัมบูรณ์ของผลต่างในรูปบาท ใช้แสดงข้อความ "ยอดขาด/เกิน X บาท" */
export function formatVarianceMagnitude(varianceSatang: number): string {
  return formatSatangToBaht(Math.abs(varianceSatang));
}

export type VarianceKind = 'match' | 'short' | 'over';

/**
 * แปลผลต่างเป็นชนิด — จุดเดียวในโค้ดที่ตัดสินว่าเป็นเงินขาดหรือเงินเกิน
 * ปลอดภัยเพราะทั้งสองค่าเป็นจำนวนเต็มในช่วง safe ไม่มี epsilon ให้กังวล
 */
export function classifyVariance(varianceSatang: number): VarianceKind {
  if (varianceSatang === 0) return 'match';
  return varianceSatang < 0 ? 'short' : 'over';
}
