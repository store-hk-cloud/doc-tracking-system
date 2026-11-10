import { randomUUID } from 'node:crypto';
import { uploadImage } from '@/lib/supabase-storage';

export async function uploadToDrive(fileName, buffer, contentType, folder) {
  if (buffer.length > 10 * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกิน 10 MB กรุณาย่อขนาดก่อน');
  const fileId = randomUUID();
  const viewLink = await uploadImage(`desktop/${folder}/${fileId}-${fileName}`, buffer, contentType);
  return { fileId, viewLink };
}
