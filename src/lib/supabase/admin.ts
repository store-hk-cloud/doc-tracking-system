import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Service role client — bypasses RLS, for server-side API routes only
// ReturnType ของ generic factory ทำให้ schema ถูกอนุมานเป็น never ใน SDK รุ่นใหม่
let _admin: SupabaseClient | null = null;

export function getServiceSupabase() {
  if (_admin) return _admin;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return _admin;
}

/**
 * escape ค่าที่จะเอาไปเทียบแบบ "ตรงตัว" ด้วย .ilike()
 *
 * ต้องใช้ทุกครั้งที่ ilike ทำหน้าที่ "หาแถวที่ค่าตรงกัน" (ไม่ใช่ค้นหาแบบ %คำ%)
 * เพราะ `%` และ `_` เป็น wildcard ของ LIKE: ชื่อผู้ใช้ที่มี `_` (regex ของระบบ
 * อนุญาต) หรือชื่อสาขาที่ผู้ใช้พิมพ์ผิดติด `_` มา จะกลายเป็นแมตช์แถวอื่น
 *
 * อาการที่เคยเกิด: `.ilike('username', '_______')` คืนอีเมลของผู้ใช้จริง และการ
 * ตรวจชื่อซ้ำที่ใช้ maybeSingle() จะ error เงียบ ๆ เมื่อ wildcard แมตช์หลายแถว
 * ทำให้ "ข้ามการตรวจซ้ำ" ไปเลย
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
