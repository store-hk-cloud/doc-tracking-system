import { put, del } from '@vercel/blob';

export async function uploadImage(
  fileName: string,
  fileBuffer: Buffer,
  mimeType: string = 'image/jpeg'
): Promise<string> {
  try {
    const blob = await put(fileName, fileBuffer, {
      contentType: mimeType,
      access: 'public',
    });
    return blob.url;
  } catch (error) {
    console.error('[Vercel Blob] Upload error:', error);
    throw new Error('Failed to upload image');
  }
}

export async function deleteImage(url: string): Promise<void> {
  try {
    await del(url);
  } catch (error) {
    console.error('[Vercel Blob] Delete error:', error);
  }
}