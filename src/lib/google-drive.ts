import { getDriveClient } from './google-auth';

export async function uploadToDrive(
  fileName: string,
  fileBuffer: Buffer,
  mimeType: string
): Promise<{ fileId: string; viewLink: string }> {
  try {
    const drive = getDriveClient();
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    const res = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: folderId ? [folderId] : [],
      },
      media: {
        mimeType,
        body: fileBuffer,
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