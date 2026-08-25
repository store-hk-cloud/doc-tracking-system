/**
 * เลขที่เอกสารที่ใช้สื่อสารกับคน — รูปแบบ 2026-08/001 นับใหม่ทุกเดือน
 *
 * ยังต้อง fallback ไป running_no เพราะ display_no เพิ่งมีใน migration 020
 * ถ้ามีแถวไหน backfill ไม่ติด (เช่น received_date ว่าง) จะได้ไม่แสดงช่องว่าง
 */
export function documentNo(doc: { display_no?: string | null; running_no?: number | null }): string {
  return doc.display_no || (doc.running_no != null ? String(doc.running_no) : '-');
}
