const BATCH_LIMIT = 50;

export function makeReceiptDraft(rows, signature, nextId = () => crypto.randomUUID()) {
  const signatureName = signature.trim();
  if (rows.length < 1 || rows.length > BATCH_LIMIT || !signatureName) {
    throw new RangeError('กรุณาเลือกเอกสาร 1–50 รายการและระบุชื่อผู้ลงนาม');
  }
  return {
    batchId: nextId(),
    items: rows.map(row => ({
      recipientId: row.recipient_id,
      expectedUpdatedAt: row.updated_at,
    })),
    signatureName,
  };
}

export function countBatchItems(batch) {
  const counts = { queued: 0, succeeded: 0, failed: 0 };
  for (const item of batch.items) counts[item.status] += 1;
  return counts;
}

export function unavailableReceipts(batches) {
  const revisions = new Set();
  for (const { items } of batches) {
    for (const item of items) {
      if (item.status !== 'failed') revisions.add(item.recipient_id + ':' + item.expected_updated_at);
    }
  }
  return (id, revision) => revisions.has(id + ':' + revision);
}

export function finishedReceipt(previous, latest) {
  const blocked = unavailableReceipts(previous.map(({ items }) => ({
    items: items.filter(item => item.status === 'queued'),
  })));
  return latest.some(({ items }) => items.some(item =>
    item.status !== 'queued' && blocked(item.recipient_id, item.expected_updated_at)));
}

export function matchingSelection(previous, latest, selected) {
  const revisions = new Map(previous.filter(row => selected.has(row.recipient_id))
    .map(row => [row.recipient_id, row.updated_at]));
  return latest.filter(row => revisions.get(row.recipient_id) === row.updated_at)
    .map(row => row.recipient_id);
}

const itemErrors = {
  receipt_stale: 'ข้อมูลเอกสารเปลี่ยนแล้ว กรุณาตรวจรายการล่าสุด',
  receipt_duplicate: 'เอกสารรอบนี้อยู่ในคิวอื่นแล้ว',
  recipient_already_processed: 'เอกสารถูกดำเนินการแล้ว',
  document_recipient_not_found: 'ไม่พบเอกสาร',
  receipt_forbidden: 'ไม่มีสิทธิ์รับเอกสารนี้แล้ว',
};

const stageLabels = {
  delivered: 'ส่งถึงฝ่ายแล้ว',
  awaiting_recipient: 'รอผู้รับลงนาม',
};

const formatter = new Intl.DateTimeFormat('th-TH', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok',
});

function displayDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? formatter.format(date) : '—';
}

function node(tag, value) {
  const element = document.createElement(tag);
  element.textContent = value ?? '—';
  return element;
}

function start({ login, logout, getSession, listPending, submitReceipts, listBatches }) {
  const el = id => document.getElementById(id);
  const selected = new Set();
  let rows = [];
  let batches = [];
  let active = false;
  let generation = 0;
  let loading = false;
  let refreshing = false;
  let submitting = false;
  let appliedSearch = '';
  let draft = null;
  let timer;
  let pollingSince = 0;

  function status(id, message, error = false) {
    el(id).textContent = message;
    el(id).classList.toggle('desktop-error', error);
  }

  function renderSelection() {
    const available = rows.filter(row => !unavailable(row));
    const bulkSelection = available.slice(0, BATCH_LIMIT);
    el('selection-count').textContent = 'เลือก ' + selected.size + ' / ' + BATCH_LIMIT + ' รายการ';
    el('submit-receipt').textContent = draft ? 'ตรวจสอบและส่งชุดเดิมอีกครั้ง' : 'ลงนามรับเอกสาร';
    el('submit-receipt').disabled = loading || refreshing || submitting || (!draft && !selected.size);
    el('signature').readOnly = Boolean(draft) || submitting;
    el('select-all').disabled = !available.length || Boolean(draft) || loading || submitting;
    el('select-all').checked = bulkSelection.length > 0 && bulkSelection.every(row => selected.has(row.recipient_id));
    el('select-all').indeterminate = selected.size > 0 && !el('select-all').checked;
    for (const input of el('pending-rows').querySelectorAll('input')) {
      const row = rows[Number(input.dataset.index)];
      input.checked = selected.has(row.recipient_id);
      input.disabled = unavailable(row) || Boolean(draft) || loading || submitting
        || (!input.checked && selected.size >= BATCH_LIMIT);
    }
  }

  let blocked = unavailableReceipts([]);
  const unavailable = row => blocked(row.recipient_id, row.updated_at);

  function renderRows() {
    const body = el('pending-rows');
    body.replaceChildren();
    for (const [index, row] of rows.entries()) {
      const tr = document.createElement('tr');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.index = String(index);
      input.setAttribute('aria-label', 'เลือกเอกสาร ' + (row.document_no ?? index + 1));
      input.addEventListener('change', () => {
        if (input.checked && selected.size < BATCH_LIMIT) selected.add(row.recipient_id);
        if (!input.checked) selected.delete(row.recipient_id);
        renderSelection();
      });
      const choice = document.createElement('td');
      choice.append(input);
      tr.append(choice, node('td', row.document_no), node('td', row.sender), node('td', row.subject),
        node('td', displayDate(row.delivery_date)), node('td', row.department),
        node('td', Object.hasOwn(stageLabels, row.stage) ? stageLabels[row.stage] : row.stage));
      body.append(tr);
    }
    renderSelection();
  }

  function renderQueue() {
    const results = el('queue-results');
    const open = new Set([...results.querySelectorAll('details[open]')].map(detail => detail.dataset.batch));
    results.replaceChildren();
    blocked = unavailableReceipts(batches);
    for (const row of rows) {
      if (unavailable(row)) selected.delete(row.recipient_id);
    }
    for (const batch of batches) {
      const { queued, succeeded, failed } = countBatchItems(batch);
      const detail = document.createElement('details');
      detail.dataset.batch = batch.id;
      detail.open = open.has(batch.id);
      detail.append(node('summary', displayDate(batch.created_at) + ' · รอบันทึก ' + queued
        + ' · รับสำเร็จ ' + succeeded + ' · ไม่สำเร็จ ' + failed));
      const items = document.createElement('ul');
      for (const item of batch.items) {
        const message = item.status === 'succeeded' ? 'รับสำเร็จ'
          : item.status === 'queued' ? 'รอบันทึก'
          : 'ไม่สำเร็จ — ' + (Object.hasOwn(itemErrors, item.error) ? itemErrors[item.error] : 'กรุณาตรวจรายการล่าสุด');
        items.append(node('li', (item.document_no ?? 'เอกสาร') + ' · ' + message));
      }
      detail.append(items);
      results.append(detail);
    }
    renderSelection();
  }

  async function loadPending(keepSelection = false) {
    if (loading || submitting) return;
    const current = generation;
    const query = keepSelection ? appliedSearch : el('search').value.trim();
    loading = true;
    el('search-button').disabled = true;
    status('pending-status', 'กำลังโหลดรายการ…');
    renderSelection();
    try {
      const pending = await listPending(query);
      if (current !== generation) return;
      const retained = keepSelection ? matchingSelection(rows, pending.filter(row => !unavailable(row)), selected) : [];
      appliedSearch = query;
      rows = pending;
      selected.clear();
      for (const id of retained) selected.add(id);
      renderRows();
      status('pending-status', rows.length === 100 ? 'แสดง 100 รายการล่าสุด ใช้ช่องค้นหาเพื่อดูรายการอื่น'
        : rows.length ? 'พบ ' + rows.length + ' รายการ' : 'ไม่พบเอกสารรอรับ');
    } catch (error) {
      if (current !== generation) return;
      if (!keepSelection) {
        rows = [];
        selected.clear();
        renderRows();
      }
      status('pending-status', error?.retryable === false ? error.message : 'โหลดรายการไม่ได้ กรุณาลองใหม่', true);
    } finally {
      if (current === generation) {
        loading = false;
        el('search-button').disabled = false;
        renderSelection();
      }
    }
  }

  function schedulePoll() {
    clearTimeout(timer);
    if (!active || !batches.some(batch => countBatchItems(batch).queued)) {
      pollingSince = 0;
      return;
    }
    pollingSince ||= Date.now();
    if (document.visibilityState === 'hidden') return;
    timer = setTimeout(refreshQueue, Date.now() - pollingSince < 60000 ? 5000 : 15000);
  }

  async function refreshQueue() {
    if (!active || refreshing || submitting) return;
    const current = generation;
    refreshing = true;
    el('refresh-queue').disabled = true;
    renderSelection();
    try {
      const latest = await listBatches();
      if (current !== generation) return;
      const receiptFinished = finishedReceipt(batches, latest);
      batches = latest;
      if (draft && batches.some(batch => batch.id === draft.batchId)) {
        draft = null;
        selected.clear();
        status('receipt-status', 'พบคำขอในระบบแล้ว ดูผลได้ที่ด้านล่าง');
      }
      renderQueue();
      status('queue-status', batches.length ? '' : 'ยังไม่มีคำขอรับเอกสาร');
      if (receiptFinished) void loadPending(true);
    } catch (error) {
      if (current === generation) {
        status('queue-status', error?.retryable === false ? error.message : 'อัปเดตผลไม่ได้ กรุณาลองใหม่', true);
      }
    } finally {
      if (current === generation) {
        refreshing = false;
        el('refresh-queue').disabled = false;
        renderSelection();
        schedulePoll();
      }
    }
  }

  async function submit() {
    if (submitting || refreshing || loading || el('logout').disabled) return;
    try {
      draft ??= makeReceiptDraft(rows.filter(row => selected.has(row.recipient_id)), el('signature').value);
    } catch (error) {
      status('receipt-status', error.message, true);
      return;
    }
    submitting = true;
    el('logout').disabled = true;
    el('refresh-queue').disabled = true;
    status('receipt-status', 'กำลังส่งคำขอ…');
    renderSelection();
    try {
      const batch = await submitReceipts(draft);
      if (!batch || batch.id !== draft.batchId || !Array.isArray(batch.items)) {
        throw Object.assign(new Error('Invalid batch'), { retryable: true });
      }
      batches = [batch, ...batches.filter(previous => previous.id !== batch.id)];
      draft = null;
      selected.clear();
      status('receipt-status', 'ส่งคำขอแล้ว ดูผลรายเอกสารได้ที่ด้านล่าง');
      status('queue-status', '');
      renderQueue();
      pollingSince = Date.now();
    } catch (error) {
      if (error?.retryable === false) {
        draft = null;
        status('receipt-status', error.message, true);
      } else {
        status('receipt-status', 'ยังยืนยันการส่งไม่ได้ กรุณาอัปเดตผลหรือส่งชุดเดิมอีกครั้ง', true);
      }
    } finally {
      submitting = false;
      el('logout').disabled = false;
      el('refresh-queue').disabled = false;
      renderSelection();
      schedulePoll();
    }
    if (!draft) void loadPending(true);
  }

  function show(session) {
    generation += 1;
    clearTimeout(timer);
    pollingSince = 0;
    active = Boolean(session);
    rows = [];
    batches = [];
    selected.clear();
    draft = null;
    loading = false;
    refreshing = false;
    appliedSearch = '';
    el('search').value = '';
    el('signature').value = session?.user?.user_metadata?.full_name ?? '';
    el('workspace').hidden = !active;
    el('logout').hidden = !active;
    el('login-panel').hidden = active;
    el('search-button').disabled = false;
    el('refresh-queue').disabled = false;
    for (const id of ['pending-status', 'queue-status', 'receipt-status']) status(id, '');
    renderRows();
    renderQueue();
    if (active) {
      void loadPending();
      void refreshQueue();
    }
  }

  el('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (el('login-button').disabled) return;
    el('login-button').disabled = true;
    status('login-status', 'กำลังเข้าสู่ระบบ…');
    try {
      const session = await login(el('email').value.trim(), el('password').value);
      if (!session) throw new Error('Invalid session');
      status('login-status', '');
      show(session);
    } catch (error) {
      status('login-status', error?.retryable === false
        ? error.message : 'เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจอีเมล รหัสผ่าน และการเชื่อมต่อ', true);
    } finally {
      el('password').value = '';
      el('login-button').disabled = false;
    }
  });
  el('logout').addEventListener('click', async () => {
    if (el('logout').disabled) return;
    el('logout').disabled = true;
    el('email').value = '';
    show(null);
    el('login-button').disabled = true;
    const reload = setTimeout(() => window.location.reload(), 2000);
    try {
      await logout();
    } catch {
      // โหลดแอปใหม่ด้านล่างเพื่อล้างเซสชันในหน่วยความจำเมื่อ Supabase ติดต่อไม่ได้
    } finally {
      clearTimeout(reload);
      window.location.reload();
    }
  });
  el('search-form').addEventListener('submit', event => {
    event.preventDefault();
    void loadPending();
  });
  el('receipt-form').addEventListener('submit', event => {
    event.preventDefault();
    void submit();
  });
  el('refresh-queue').addEventListener('click', refreshQueue);
  document.addEventListener('visibilitychange', () => {
    clearTimeout(timer);
    if (document.visibilityState === 'visible') void refreshQueue();
  });
  el('select-all').addEventListener('change', () => {
    selected.clear();
    if (el('select-all').checked) {
      for (const row of rows.filter(row => !unavailable(row)).slice(0, BATCH_LIMIT)) selected.add(row.recipient_id);
    }
    renderSelection();
  });
  el('login-button').disabled = true;
  void Promise.resolve().then(getSession).then(show).catch(() => {
    status('login-status', 'กู้คืนเซสชันไม่ได้ กรุณาเข้าสู่ระบบอีกครั้ง', true);
  }).finally(() => { el('login-button').disabled = false; });
}

if (typeof document !== 'undefined') {
  import('./api.js').then(start).catch(() => {
    document.getElementById('login-button').disabled = true;
    document.getElementById('login-status').textContent = 'เปิดแอปไม่ได้ กรุณาตรวจการติดตั้ง';
  });
}
