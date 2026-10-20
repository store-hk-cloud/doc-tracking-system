import assert from 'node:assert/strict';
import test from 'node:test';
import { google } from 'googleapis';
import { loadModule } from './test-support/load-module.mjs';

test('image uploads use the public Supabase Storage bucket', async () => {
  let sent;
  const storage = {
    from(bucket) {
      return {
        async upload(...args) { sent = { bucket, args }; return { error: null }; },
        getPublicUrl(path) { return { data: { publicUrl: `https://storage.example.invalid/${path}` } }; },
      };
    },
  };
  const blob = loadModule('src/lib/supabase-storage.ts', {
    '@/lib/supabase/admin': { getServiceSupabase: () => ({ storage }) },
  }, { process: { env: { SUPABASE_STORAGE_BUCKET: 'doc-attachments' } } });
  const buffer = Buffer.from('test image');
  const url = await blob.uploadImage('damage/image.jpg', buffer, 'image/png');
  assert.equal(url, `https://storage.example.invalid/${sent.args[0]}`);
  assert.equal(sent.bucket, 'doc-attachments');
  assert.match(sent.args[0], /^damage\/[^/]+image\.jpg$/);
  assert.equal(sent.args[1], buffer);
  assert.equal(sent.args[2].contentType, 'image/png');
  assert.equal(sent.args[2].upsert, false);
});

test('two image uploads with the same original path never collide or overwrite evidence', async () => {
  const paths = new Set();
  const storage = { from: () => ({
    async upload(path) {
      if (paths.has(path)) return { error: { message: 'duplicate object' } };
      paths.add(path);
      return { error: null };
    },
    getPublicUrl: (path) => ({ data: { publicUrl: `https://storage.example.invalid/${path}` } }),
  }) };
  const images = loadModule('src/lib/supabase-storage.ts', {
    '@/lib/supabase/admin': { getServiceSupabase: () => ({ storage }) },
  });
  const urls = await Promise.all([
    images.uploadImage('damage/same-image.jpg', Buffer.from('image')),
    images.uploadImage('damage/same-image.jpg', Buffer.from('image')),
  ]);
  assert.equal(paths.size, 2);
  assert.notEqual(urls[0], urls[1]);
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
