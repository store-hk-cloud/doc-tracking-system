/**
 * Create a test Google Sheet with the new column structure
 * and insert 1 sample row to show the user.
 */
import { google } from 'googleapis';

const HEADERS = [
  'Running No.',
  'วันที่รับ',
  'เลขที่เอกสาร',
  'ผู้ส่ง',
  'เรื่อง',
  'หน่วยงาน',
  'สถานะ',
  'ลายเซ็น Admin',
  'เวลา Admin ลงนาม',
  'ชื่อผู้รับ',
  'ลายเซ็นผู้รับ',
  'เวลาผู้รับลงนาม',
  'ผลการตรวจสอบ',
  'หมายเหตุ (ผู้รับ)',
  'เสียหาย',
  'รูปความเสียหาย',
  'หมายเหตุ',
  'ผู้บันทึก',
  'updated_at',
];

const SAMPLE_ROW = [
  '7',
  '2026-07-02',
  '2',
  'Test1',
  'ทดสอบการส่งเอกสาร',
  'การเงิน',
  'signed',
  'Test1',
  '2026-07-02T16:52:10',
  'Test3',
  'Test3',
  '2026-07-02T16:52:33',
  'ถูกต้อง',
  'รับเรียบร้อย',
  'ไม่',
  '',
  'ทดสอบระบบ',
  'Admin',
  '2026-07-02T16:52:33',
];

// Build auth
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

if (!clientId || !clientSecret || !refreshToken) {
  console.error('Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REFRESH_TOKEN');
  process.exit(1);
}

const auth = new google.auth.OAuth2(clientId, clientSecret);
auth.setCredentials({ refresh_token: refreshToken });

// Refresh token to ensure it works
try {
  await auth.getAccessToken();
  console.log('✅ Auth OK');
} catch (err) {
  console.error('❌ Auth failed:', err.message);
  process.exit(1);
}

const sheets = google.sheets({ version: 'v4', auth });

const today = new Date().toISOString().split('T')[0]; // 2026-07-02

// Create spreadsheet
const res = await sheets.spreadsheets.create({
  requestBody: {
    properties: { title: '📋 ทดสอบโครงสร้างใหม่ - ระบบรับ-ส่งเอกสาร' },
    sheets: [
      { properties: { title: today } },
    ],
  },
});

const spreadsheetId = res.data.spreadsheetId;
console.log(`✅ Created spreadsheet: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);

// Write headers
await sheets.spreadsheets.values.update({
  spreadsheetId,
  range: `${today}!A1:S1`,
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: [HEADERS] },
});
console.log('✅ Headers written');

// Write sample row
await sheets.spreadsheets.values.append({
  spreadsheetId,
  range: `${today}!A:S`,
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: [SAMPLE_ROW] },
});
console.log('✅ Sample row written');
console.log(`\n👉 Open: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);