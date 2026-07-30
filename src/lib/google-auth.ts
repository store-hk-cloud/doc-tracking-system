import { google } from 'googleapis';

let cachedAuth: any = null;
let cachedSheets: any = null;
let cachedDrive: any = null;

/**
 * Returns an OAuth2 client using GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN
 * Falls back to Service Account (GOOGLE_SHEETS_CLIENT_EMAIL) if OAuth2 vars missing
 */
function getAuth(): any {
  if (cachedAuth) return cachedAuth;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;

  if (clientId && clientSecret && refreshToken) {
    // OAuth2 mode (auto-create sheets, no manual setup)
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    cachedAuth = oauth2;
    // Test the connection immediately
    oauth2.getAccessToken().catch((err) => {
      console.error('[Google Auth] Token refresh failed:', err.message);
    });
    return oauth2;
  }

  if (clientEmail && privateKey) {
    // Service Account mode (fallback)
    cachedAuth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey.replace(/\\n/g, '\n'),
      },
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive',
      ],
    });
    return cachedAuth;
  }

  return null;
}

export function getSheetsClient(): any {
  const auth = getAuth();
  if (!auth) throw new Error('Google Sheets not configured. Set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN in Vercel');
  if (cachedSheets) return cachedSheets;
  cachedSheets = google.sheets({ version: 'v4', auth });
  return cachedSheets;
}

export function getDriveClient(): any {
  const auth = getAuth();
  if (!auth) throw new Error('Google Drive not configured. Set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN in Vercel');
  if (cachedDrive) return cachedDrive;
  cachedDrive = google.drive({ version: 'v3', auth });
  return cachedDrive;
}

/** Returns true if Google credentials are configured */
export function hasGoogleCredentials(): boolean {
  return !!(
    (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN) ||
    (process.env.GOOGLE_SHEETS_CLIENT_EMAIL && process.env.GOOGLE_SHEETS_PRIVATE_KEY)
  );
}

export function resetClients() {
  cachedAuth = null;
  cachedSheets = null;
  cachedDrive = null;
}