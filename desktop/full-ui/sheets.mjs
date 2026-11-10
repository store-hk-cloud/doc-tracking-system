export async function runSheetsAction(path, { fetch, open }) {
  const backfill = path === '/api/admin/backfill-sheets';
  const response = await fetch(path, { method: backfill ? 'POST' : 'GET' });
  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.error || 'เชื่อมต่อ Google Sheets ไม่สำเร็จ');
  }

  if (!backfill) {
    const target = new URL(result.spreadsheetUrl);
    if (target.origin !== 'https://docs.google.com' || target.username || target.password ||
        !/^\/spreadsheets\/d\/[\w-]+(?:\/|$)/.test(target.pathname)) {
      throw new Error('ลิงก์ Google Sheets ไม่ถูกต้อง');
    }
    open(target.href);
    return '';
  }
  if (typeof result.queued === 'number') return `เข้าคิวอัปเดต Google Sheets แล้ว ${result.queued} รายการ`;
  return result.message || `อัปเดต Google Sheets แล้ว ${result.updated ?? 0} รายการ เพิ่ม ${result.appended ?? 0} รายการ`;
}
