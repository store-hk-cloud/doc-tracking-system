import { google } from 'googleapis';

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_DRIVE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_DRIVE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
}

const drive = google.drive({ version: 'v3', auth: getAuth() });

export async function uploadToDrive(
  fileName: string,
  fileBuffer: Buffer,
  mimeType: string
): Promise<string> {
  try {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
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
    return fileId;
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
    await drive.files.delete({ fileId });
  } catch (error) {
    console.error('[Google Drive] Delete error:', error);
  }
}