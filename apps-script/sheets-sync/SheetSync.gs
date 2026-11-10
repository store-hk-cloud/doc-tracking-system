const SYNC_SPREADSHEET_ID = '1qremvBM2GKrh5IXV9JH9KNZ6W-M8TFXgOi5_ReitEWI';
const SYNC_BATCH_SIZE = 20;
const SYNC_DAILY_TAB = /^\d{4}-\d{2}-\d{2}$/;
const SYNC_HEADERS = [
  'เลขที่รับเข้า', 'วันที่รับ', 'เลขที่เอกสาร', 'ผู้ส่ง', 'เรื่อง', 'หน่วยงาน', 'สถานะ',
  'ลายเซ็น Admin', 'เวลา Admin ลงนาม', 'ชื่อผู้รับ', 'ลายเซ็นผู้รับ', 'เวลาผู้รับลงนาม',
  'ผลการตรวจสอบ', 'หมายเหตุ (ผู้รับ)', 'เสียหาย', 'รูปความเสียหาย', 'หมายเหตุ', 'ผู้บันทึก',
  'updated_at', 'เลขใบกำกับภาษี', 'รหัสอ้างอิง',
];

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ service: 'doc-tracking-sheets', version: 1 }))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheetSyncConfig_() {
  const settings = PropertiesService.getScriptProperties().getProperties();
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(settings.SUPABASE_URL || '') ||
      !settings.SUPABASE_PUBLISHABLE_KEY || !/^[a-f0-9]{64}$/.test(settings.SHEETS_SYNC_TOKEN || '')) {
    throw new Error('ตั้งค่า SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY และ SHEETS_SYNC_TOKEN ใน Script Properties ก่อน');
  }
  return settings;
}

function sheetSyncRpc_(settings, name, args) {
  const url = settings.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/' + name;
  const response = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, followRedirects: false,
    headers: { apikey: settings.SUPABASE_PUBLISHABLE_KEY },
    payload: JSON.stringify({ ...args, p_token: settings.SHEETS_SYNC_TOKEN }),
  });
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error('Supabase ' + name + ' HTTP ' + status);
  return JSON.parse(response.getContentText());
}

function checkSheetSync() {
  const settings = sheetSyncConfig_();
  const jobs = sheetSyncRpc_(settings, 'pull_apps_script_sheet_jobs', { p_limit: 0 });
  if (!Array.isArray(jobs)) throw new Error('รูปแบบข้อมูลจากคิวไม่ถูกต้อง');
  const spreadsheet = SpreadsheetApp.openById(SYNC_SPREADSHEET_ID);
  const sheet = spreadsheet.getSheets()[0];
  if (!sheet) throw new Error('ไม่พบแท็บใน Google Sheets');
  Sheets.Spreadsheets.Values.get(SYNC_SPREADSHEET_ID, "'" + sheet.getName().replace(/'/g, "''") + "'!A1");
  return { ready: true };
}

function installSheetSync() {
  checkSheetSync();
  const existing = ScriptApp.getProjectTriggers().find(trigger => trigger.getHandlerFunction() === 'syncPendingSheetJobs');
  if (!existing) ScriptApp.newTrigger('syncPendingSheetJobs').timeBased().everyMinutes(5).create();
}

function syncPendingSheetJobs() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { skipped: true };
  try {
    const settings = sheetSyncConfig_();
    const jobs = sheetSyncRpc_(settings, 'pull_apps_script_sheet_jobs', { p_limit: SYNC_BATCH_SIZE });
    if (!Array.isArray(jobs)) throw new Error('รูปแบบข้อมูลจากคิวไม่ถูกต้อง');
    if (!jobs.length) return { written: 0, failed: 0 };

    const spreadsheet = SpreadsheetApp.openById(SYNC_SPREADSHEET_ID);
    const index = new Map();
    const nextRows = new Map();
    const runningNumbers = new Map();
    const deadline = Date.now() + 120000;
    let written = 0;
    let failed = 0;
    for (const job of jobs) {
      if (Date.now() >= deadline) break;
      let success = true;
      try {
        writeSheetJob_(spreadsheet, index, nextRows, runningNumbers, job);
      } catch {
        success = false;
        failed++;
        console.warn('งานซิงก์ชีทไม่สำเร็จและจะลองใหม่');
      }
      // ถ้าเขียนแล้วแต่ตอบรับไม่ได้ รอบหน้าจะหาแถวเดิมจากรหัสใน U
      sheetSyncRpc_(settings, 'finish_apps_script_sheet_job', {
        p_id: job.id, p_revision: job.revision, p_success: success,
      });
      if (!success) break;
      written++;
    }
    return { written, failed };
  } finally {
    lock.releaseLock();
  }
}

function writeSheetJob_(spreadsheet, index, nextRows, runningNumbers, job) {
  if (!SYNC_DAILY_TAB.test(job.sheet_name) || !Array.isArray(job.values) ||
      job.values.length !== SYNC_HEADERS.length || job.values[20] !== job.id) {
    throw new Error('รูปแบบแถวเอกสารไม่ถูกต้อง');
  }

  const preferred = spreadsheet.getSheetByName(job.sheet_name);
  if (preferred && !index.has(job.sheet_name)) {
    const response = Sheets.Spreadsheets.Values.get(SYNC_SPREADSHEET_ID, sheetRange_(job.sheet_name, 'U:U'));
    index.set(job.sheet_name, indexReferences_(response.values || []));
  }
  let location = sheetRowLocation_(index, job.sheet_name, job.id);
  if (!location) {
    // วันที่รับอาจถูกแก้หลังจากเคยส่งออก แถวเดิมจึงอาจอยู่ในแท็บรายวันอื่น
    const unloaded = spreadsheet.getSheets().map(sheet => sheet.getName())
      .filter(name => SYNC_DAILY_TAB.test(name) && !index.has(name));
    for (let start = 0; start < unloaded.length; start += 50) {
      const names = unloaded.slice(start, start + 50);
      const response = Sheets.Spreadsheets.Values.batchGet(SYNC_SPREADSHEET_ID, {
        ranges: names.map(name => sheetRange_(name, 'U:U')),
      });
      if (response.valueRanges?.length !== names.length) throw new Error('อ่านรหัสอ้างอิงไม่ครบ');
      names.forEach((name, i) => index.set(name, indexReferences_(response.valueRanges[i].values || [])));
    }
    for (const name of index.keys()) {
      const match = sheetRowLocation_(index, name, job.id);
      if (!match) continue;
      if (location) throw new Error('พบรหัสอ้างอิงซ้ำหลายแท็บ');
      location = match;
    }
  }
  if (location) {
    const { name, row } = location;
    const response = Sheets.Spreadsheets.Values.get(SYNC_SPREADSHEET_ID, sheetRange_(name, 'A' + row + ':U' + row));
    const previous = response.values?.[0];
    // ข้อมูลเก่าบางแถวอาจผูกรหัส U ผิดใบ ต้องตรวจเลขรับเข้าก่อนเขียนทับ
    if (previous?.[20] !== job.id || String(previous[0] ?? '') !== String(job.values[0] ?? '')) {
      throw new Error('รหัสอ้างอิงกับเลขรับเข้าไม่ตรงกัน');
    }
  } else {
    location = findLegacySheetRow_(index, runningNumbers, job);
  }
  if (location) {
    writeRawSheetRow_(location.name, location.row, job.values);
    index.get(location.name).set(job.id, location.row);
    return;
  }

  const sheet = preferred || spreadsheet.insertSheet(job.sheet_name);
  if (sheet.getMaxColumns() < SYNC_HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), SYNC_HEADERS.length - sheet.getMaxColumns());
  }
  const row = nextRows.get(job.sheet_name) || Math.max(2, sheet.getLastRow() + 1);
  if (!nextRows.has(job.sheet_name) && sheet.getLastRow() === 0) {
    SpreadsheetApp.flush();
    writeRawSheetRow_(job.sheet_name, 1, SYNC_HEADERS);
    sheet.setFrozenRows(1);
  }
  if (row > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), row - sheet.getMaxRows());
    SpreadsheetApp.flush();
  }
  writeRawSheetRow_(job.sheet_name, row, job.values);
  nextRows.set(job.sheet_name, row + 1);
  if (!index.has(job.sheet_name)) index.set(job.sheet_name, new Map());
  index.get(job.sheet_name).set(job.id, row);
}

function findLegacySheetRow_(index, runningNumbers, job) {
  const number = String(job.values[0] || '');
  if (!number || number === '-') return null;
  const unloaded = [...index.keys()].filter(name => !runningNumbers.has(name));
  for (let start = 0; start < unloaded.length; start += 50) {
    const names = unloaded.slice(start, start + 50);
    const response = Sheets.Spreadsheets.Values.batchGet(SYNC_SPREADSHEET_ID, {
      ranges: names.map(name => sheetRange_(name, 'A:A')),
    });
    if (response.valueRanges?.length !== names.length) throw new Error('อ่านเลขที่รับเข้าไม่ครบ');
    names.forEach((name, i) => runningNumbers.set(name, response.valueRanges[i].values || []));
  }

  const candidates = [];
  for (const [name, rows] of runningNumbers) {
    const referencedRows = new Set(index.get(name).values());
    rows.forEach(([value], i) => {
      if (String(value ?? '') === number && !referencedRows.has(i + 1)) candidates.push({ name, row: i + 1 });
    });
  }
  if (!candidates.length) return null;
  if (!job.single_recipient || candidates.length !== 1) throw new Error('จับคู่แถวเดิมโดยไม่มีรหัสไม่ได้');

  const { name, row } = candidates[0];
  const response = Sheets.Spreadsheets.Values.get(SYNC_SPREADSHEET_ID, sheetRange_(name, 'A' + row + ':U' + row));
  const previous = response.values?.[0];
  // แถวเดิมต้องไม่มี U และตรงกับเลขเอกสาร ผู้ส่ง และปลายทาง เพื่อกันการเขียนทับคนละใบ
  if (!previous || previous[20] || [2, 3, 5].some(i => String(previous[i] ?? '') !== String(job.values[i] ?? ''))) {
    throw new Error('ข้อมูลแถวเดิมไม่ตรงกับเอกสาร');
  }
  return candidates[0];
}

function indexReferences_(values) {
  const references = new Map();
  values.forEach(([id], i) => {
    if (id) references.set(id, references.has(id) ? null : i + 1);
  });
  return references;
}

function sheetRowLocation_(index, name, id) {
  const row = index.get(name)?.get(id);
  if (row === null) throw new Error('พบรหัสอ้างอิงซ้ำในแท็บ');
  return row ? { name, row } : null;
}

function sheetRange_(name, cells) {
  return "'" + name + "'!" + cells;
}

function writeRawSheetRow_(name, row, values) {
  Sheets.Spreadsheets.Values.update({ values: [values] }, SYNC_SPREADSHEET_ID,
    sheetRange_(name, 'A' + row + ':U' + row), { valueInputOption: 'RAW' });
}
