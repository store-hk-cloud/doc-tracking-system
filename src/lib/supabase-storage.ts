import { getServiceSupabase } from '@/lib/supabase/admin';
import { randomUUID } from 'crypto';

const DEFAULT_BUCKET = 'doc-attachments';

function getBucketName() {
  return process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET;
}

export async function uploadImage(
  fileName: string,
  fileBuffer: Buffer,
  mimeType: string = 'image/jpeg'
): Promise<string> {
  const bucket = getBucketName();
  // รูปชื่อเดียวกันอาจถูกส่งพร้อมกันในมิลลิวินาทีเดียว จึงใช้ UUID แทนการพึ่งเวลาอย่างเดียว
  const storagePath = fileName.replace(/[^/]+$/, (name) => `${randomUUID()}-${name}`);
  const { error } = await getServiceSupabase().storage.from(bucket).upload(storagePath, fileBuffer, {
    contentType: mimeType,
    upsert: false,
  });
  if (error) {
    console.error('[Supabase Storage] Upload error:', error);
    throw new Error('Failed to upload image');
  }

  const { data } = getServiceSupabase().storage.from(bucket).getPublicUrl(storagePath);
  return data.publicUrl;
}

export async function deleteImage(fileName: string): Promise<void> {
  const { error } = await getServiceSupabase().storage.from(getBucketName()).remove([fileName]);
  if (error) console.error('[Supabase Storage] Delete error:', error);
}
