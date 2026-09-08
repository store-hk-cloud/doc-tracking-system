import assert from 'node:assert/strict';
import test from 'node:test';
import { google } from 'googleapis';
import { loadModule } from './test-support/load-module.mjs';

test('image uploads explicitly preserve unique names across Blob SDK upgrades', async () => {
  let sent;
  const blob = loadModule('src/lib/vercel-blob.ts', {
    '@vercel/blob': { put: async (...args) => { sent = args; return { url: 'https://example.invalid/image.jpg' }; } },
  });
  const buffer = Buffer.from('test image');
  assert.equal(await blob.uploadImage('damage/image.jpg', buffer, 'image/png'), 'https://example.invalid/image.jpg');
  assert.equal(sent[0], 'damage/image.jpg');
  assert.equal(sent[1], buffer);
  assert.equal(sent[2].contentType, 'image/png');
  assert.equal(sent[2].access, 'public');
  assert.equal(sent[2].addRandomSuffix, true);
});

test('Google OAuth clients preserve credentials, cached clients and Sheets/Drive request shapes', async () => {
  const requests = [];
  class OfflineOAuth extends google.auth.OAuth2 {
    async getAccessToken() { return { token: 'test-access-token' }; }
    async request(options) { requests.push(options); return { data: { id: 'test-file' } }; }
  }
  const auth = loadModule('src/lib/google-auth.ts', {
    googleapis: { google: { ...google, auth: { ...google.auth, OAuth2: OfflineOAuth } } },
  }, { process: { env: { GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', GOOGLE_REFRESH_TOKEN: 'test-refresh' } } });
  assert.equal(auth.hasGoogleCredentials(), true);
  const sheets = auth.getSheetsClient();
  const drive = auth.getDriveClient();
  assert.equal(sheets, auth.getSheetsClient());
  assert.equal(drive, auth.getDriveClient());
  const oauth = sheets.context._options.auth;
  assert.equal(oauth.credentials.refresh_token, 'test-refresh');
  assert.equal(drive.context._options.auth, oauth);
  await sheets.spreadsheets.values.update({ spreadsheetId: 'test-sheet', range: 'Today!A1:U1', valueInputOption: 'USER_ENTERED', requestBody: { values: [['ทดสอบ']] } });
  await drive.files.create({ requestBody: { name: 'test.jpg', parents: ['test-folder'] } });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].method, 'PUT');
  assert.deepEqual(requests[0].data, { values: [['ทดสอบ']] });
  assert.equal(requests[1].method, 'POST');
  assert.deepEqual(requests[1].data, { name: 'test.jpg', parents: ['test-folder'] });
});

test('Google service-account fallback still creates Sheets v4 and Drive v3 clients', () => {
  const auth = loadModule('src/lib/google-auth.ts', {}, { process: { env: {
    GOOGLE_SHEETS_CLIENT_EMAIL: 'test@example.invalid', GOOGLE_SHEETS_PRIVATE_KEY: 'test\\nkey',
  } } });
  const sheets = auth.getSheetsClient();
  const drive = auth.getDriveClient();
  assert.ok(sheets.context._options.auth instanceof google.auth.GoogleAuth);
  assert.equal(sheets.context._options.auth, drive.context._options.auth);
  assert.equal(typeof sheets.spreadsheets.values.update, 'function');
  assert.equal(typeof drive.files.create, 'function');
});
