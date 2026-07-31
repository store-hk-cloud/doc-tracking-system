import { Readable } from 'stream';
import { getDriveClient } from './google-auth';

const subfolderCache = new Map<string, string>();

/** Finds a subfolder by name under parentId, creating it if it doesn't exist yet. */
async function getOrCreateSubfolder(name: string, parentId: string): Promise<string> {
  const cacheKey = `${parentId}/${name}`;
  const cached = subfolderCache.get(cacheKey);
  if (cached) return cached;

  const drive = getDriveClient();
  const escapedName = name.replace(/'/g, "\\'");
  const { data: existing } = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${escapedName}' and '${parentId}' in parents and trashed=false`,
    fields: 'files(id, name)',
    pageSize: 1,
  });
  if (existing.files && existing.files.length > 0) {
    const id = existing.files[0].id!;
    subfolderCache.set(cacheKey, id);
    return id;
  }

  const { data: created } = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
  });
  const id = created.id!;
  subfolderCache.set(cacheKey, id);
  return id;
}

export async function uploadToDrive(
  fileName: string,
  fileBuffer: Buffer,
  mimeType: string,
  subfolder?: string
): Promise<{ fileId: string; viewLink: string }> {
  try {
    const drive = getDriveClient();
    const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    let parentId = rootFolderId;
    if (subfolder && rootFolderId) {
      parentId = await getOrCreateSubfolder(subfolder, rootFolderId);
    }
    const res = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: parentId ? [parentId] : [],
      },
      media: {
        mimeType,
        body: Readable.from(fileBuffer),
      },
    });
    const fileId = res.data.id!;
    // Make file publicly viewable
    await drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'anyone' },
    });
    const viewLink = getDriveViewLink(fileId);
    return { fileId, viewLink };
  } catch (error) {
    console.error('[Google Drive] Upload error:', error);
    throw new Error('Failed to upload file to Google Drive');
  }
}

export function getDriveViewLink(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

export async function deleteFromDrive(fileId: string): Promise<void> {
  try {
    const drive = getDriveClient();
    await drive.files.delete({ fileId });
  } catch (error) {
    console.error('[Google Drive] Delete error:', error);
  }
}