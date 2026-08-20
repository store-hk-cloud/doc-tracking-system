'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { getGoodsReceiptWorkflowAction, isGoodsReceipt } from '@/lib/document-workflow';

const todayStr = () => new Date().toISOString().split('T')[0];
const PENDING_STATUSES = ['delivered', 'awaiting_inspector', 'awaiting_purchasing', 'awaiting_recipient'];
const ACTION_LABELS: Record<string, string> = {
  inspector: 'เซ็นผู้ตรวจสอบ',
  purchasing: 'เซ็นจัดซื้อ',
  recipient: 'ลงชื่อรับ',
};

export default function RecipientListPage() {
  const { profile } = useAuth();

  const [tab, setTab] = useState<'pending' | 'closed'>('pending');

  // Pending tab
  const [pendingDocs, setPendingDocs] = useState<any[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  // ค่าว่าง = แสดงทุกวัน ซึ่งเป็นค่าเริ่มต้น เพราะหน้านี้คือ "คิวงานที่ค้าง"
  // เดิมล็อกไว้ที่วันนี้วันเดียว งานที่ค้างจากวันก่อนจึงมองไม่เห็นและ "เลือกทั้งหมด"
  // ก็หมายถึงทั้งหมดของวันนั้นเท่านั้น (ตรวจข้อมูลจริง: ค้าง 114 รายการกระจายอยู่ 7 วัน
  // วันนี้มีแค่ 9 รายการ อีก 105 รายการถูกซ่อนไว้)
  const [pendingDate, setPendingDate] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSigning, setBulkSigning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [bulkMessage, setBulkMessage] = useState('');
  const [bulkFailures, setBulkFailures] = useState<{ label: string; error: string }[]>([]);
  const [showBulkSignModal, setShowBulkSignModal] = useState(false);
  const [bulkSignature, setBulkSignature] = useState('');
  const [bulkSignError, setBulkSignError] = useState('');

  // Closed tab
  const [closedDocs, setClosedDocs] = useState<any[]>([]);
  const [closedLoading, setClosedLoading] = useState(false);
  const [closedLoaded, setClosedLoaded] = useState(false);
  const [closedFilter, setClosedFilter] = useState({ keyword: '', date_from: '', date_to: '' });

  // API ตัดสิทธิ์ตามขั้น workflow แล้ว ห้ามกรองด้วย recipient_dept_id ที่หน้าเว็บ
  // เพราะใบรับสินค้าเก็บ recipient เป็นบัญชี แม้ผู้ตรวจสอบ/จัดซื้ออยู่คนละหน่วยงาน.
  const loadPending = async () => {
    setPendingLoading(true);
    try {
      const statusQuery = PENDING_STATUSES.map((status) => `status=${status}`).join('&');
      const res = await window.fetch(`/api/documents?${statusQuery}`);
      const data = await res.json();
      if (data.success) setPendingDocs(data.data.filter((d: any) => PENDING_STATUSES.includes(d.status)));
    } catch (e) {
      console.error('fetch pending docs error:', e);
    }
    setPendingLoading(false);
  };

  const loadClosed = async () => {
    setClosedLoading(true);
    try {
      let url = '/api/documents?status=closed&status=signed';
      if (closedFilter.keyword) url += `&keyword=${encodeURIComponent(closedFilter.keyword)}`;
      if (closedFilter.date_from) url += `&date_from=${closedFilter.date_from}`;
      if (closedFilter.date_to) url += `&date_to=${closedFilter.date_to}`;
      const res = await window.fetch(url);
      const data = await res.json();
      if (data.success) setClosedDocs(data.data.filter((d: any) => ['closed', 'signed'].includes(d.status)));
    } catch (e) {
      console.error('fetch closed docs error:', e);
    }
    setClosedLoading(false);
    setClosedLoaded(true);
  };

  useEffect(() => { loadPending(); }, []);

  useEffect(() => {
    if (tab === 'closed' && !closedLoaded) loadClosed();
  }, [tab]);

  const workflowAction = (doc: any) => isGoodsReceipt(doc.subject)
    ? getGoodsReceiptWorkflowAction(profile?.department_code, doc.status)
    : profile?.department_id === doc.recipient_dept_id && doc.status === 'delivered' ? 'recipient' : null;
  const canReceive = (doc: any) => workflowAction(doc) === 'recipient';

  const visiblePending = pendingDocs.filter(
    (d: any) => !pendingDate || (d.admin_signed_at || '').split('T')[0] === pendingDate
  );
  const signablePending = visiblePending.filter(canReceive);
  const allSignableSelected = signablePending.length > 0 && signablePending.every((d: any) => selectedIds.has(d.id));

  const toggleSelect = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // เทียบว่า "ทุกใบที่เลือกได้ถูกเลือกแล้วหรือยัง" ไม่ใช่เทียบแค่จำนวน เพราะจำนวน
  // เท่ากันได้ทั้งที่เป็นชุดคนละชุด (เช่นเลือกไว้แล้วเปลี่ยนตัวกรองวันที่)
  const toggleSelectAll = () => {
    setSelectedIds(allSignableSelected ? new Set() : new Set(signablePending.map((d: any) => d.id)));
  };

  const openBulkSignModal = () => {
    if (selectedIds.size === 0) return;
    setBulkSignature(profile?.full_name || '');
    setBulkSignError('');
    setShowBulkSignModal(true);
  };

  const handleBulkSign = async () => {
    const recipientSignature = bulkSignature.trim();
    if (!recipientSignature) {
      setBulkSignError('กรุณาระบุชื่อผู้รับเอกสาร');
      return;
    }
    const targets = signablePending.filter((d: any) => selectedIds.has(d.id));
    setBulkSigning(true);
    setBulkSignError('');
    setBulkMessage('');
    setBulkFailures([]);
    setBulkProgress({ done: 0, total: targets.length });
    setShowBulkSignModal(false);

    const receiveOne = async (doc: any) => {
      try {
        const res = await window.fetch('/api/deliveries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            document_recipient_id: doc.id,
            is_verified: true,
            recipient_signature: recipientSignature,
            verification_note: null,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!data?.success) {
          return { ok: false, label: `เลขที่ ${doc.running_no}`, error: data?.error || `HTTP ${res.status}` };
        }
        return { ok: true };
      } catch (e: any) {
        return { ok: false, label: `เลขที่ ${doc.running_no}`, error: e?.message || 'ส่งคำขอไม่สำเร็จ' };
      }
    };

    // ส่งพร้อมกันได้ไม่เกิน 4 คำขอ: ฝั่งเซิร์ฟเวอร์แต่ละรายการต้องไปอัปเดต Google
    // Sheets ซึ่งอ่านทุกแท็บทุกแถวเพื่อหาแถวของเอกสารนั้น ยิง 50 คำขอพร้อมกันจะชน
    // โควตาของ Sheets แล้วช้ากว่าเดิม ไม่ใช่เร็วกว่า
    const CONCURRENCY = 4;
    const queue = [...targets];
    const failures: { label: string; error: string }[] = [];
    let okCount = 0;
    const worker = async () => {
      for (;;) {
        const doc = queue.shift();
        if (!doc) return;
        const result = await receiveOne(doc);
        if (result.ok) okCount += 1;
        else failures.push({ label: result.label!, error: result.error! });
        setBulkProgress((current) => ({ ...current, done: current.done + 1 }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

    setBulkMessage(
      failures.length > 0
        ? `ลงชื่อรับสำเร็จ ${okCount} รายการ · ไม่สำเร็จ ${failures.length} รายการ`
        : `✅ ลงชื่อรับสำเร็จ ${okCount} รายการ`
    );
    setBulkFailures(failures);
    setSelectedIds(new Set());
    setBulkSigning(false);
    setBulkProgress({ done: 0, total: 0 });
    await loadPending();
    setClosedLoaded(false);
  };

  return (
    <div>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="title-badge">✍️ รับเอกสาร</div>
        <h2>เอกสารรอดำเนินการ</h2>
        <div className="title-accent" />
      </div>

      <div className="segmented-control" style={{ marginBottom: 16 }}>
        <button className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}>
          รอดำเนินการ
        </button>
        <button className={tab === 'closed' ? 'active' : ''} onClick={() => setTab('closed')}>
          ปิดงานแล้ว
        </button>
      </div>

      {tab === 'pending' ? (
        <div className="scan-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
              วันที่ส่งมอบ:
              <input type="date" value={pendingDate} onChange={(e) => setPendingDate(e.target.value)} />
            </label>
            {pendingDate !== '' && (
              <button className="ghost-button" style={{ width: 'auto', padding: '0 12px' }} onClick={() => setPendingDate('')}>
                แสดงทุกวัน
              </button>
            )}
            {pendingDate !== todayStr() && (
              <button className="ghost-button" style={{ width: 'auto', padding: '0 12px' }} onClick={() => setPendingDate(todayStr())}>
                เฉพาะวันนี้
              </button>
            )}
            <span style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
              {pendingDate ? `แสดงเฉพาะวันที่ ${pendingDate}` : `งานค้างทุกวัน ${visiblePending.length} รายการ`}
            </span>
          </div>

          {/* แถบนี้อยู่เหนือตารางเสมอเมื่อมีงานที่รับได้ เพราะช่องติ๊ก "เลือกทั้งหมด"
              อยู่ในหัวตารางที่กว้างอย่างน้อย 720px บนมือถือจึงอยู่นอกจอจนกว่าจะเลื่อนไปหา */}
          {signablePending.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                marginBottom: 12,
                padding: '10px 14px',
                background: 'var(--primary-soft)',
                borderRadius: 8,
                flexWrap: 'wrap',
              }}
            >
              <button
                className="ghost-button"
                style={{ width: 'auto', padding: '0 14px' }}
                onClick={toggleSelectAll}
                disabled={bulkSigning}
              >
                {allSignableSelected ? 'ไม่เลือกเลย' : `เลือกทั้งหมด (${signablePending.length})`}
              </button>
              <span style={{ fontWeight: 700 }}>
                {selectedIds.size > 0 ? `เลือกแล้ว ${selectedIds.size} รายการ` : `รับได้ ${signablePending.length} รายการ`}
              </span>
              <button
                className="secondary-button"
                style={{ width: 'auto', padding: '0 16px' }}
                onClick={openBulkSignModal}
                disabled={bulkSigning || selectedIds.size === 0}
              >
                {bulkSigning
                  ? `กำลังดำเนินการ ${bulkProgress.done}/${bulkProgress.total}`
                  : `✅ ลงชื่อรับ ${selectedIds.size || ''} รายการ`}
              </button>
            </div>
          )}

          {bulkMessage && (
            <div
              className={`toast ${bulkFailures.length > 0 ? 'warning' : 'success'}`}
              style={{ position: 'static', marginBottom: 12 }}
            >
              {bulkMessage}
              {bulkFailures.length > 0 && (
                <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: '0.82rem', fontWeight: 400 }}>
                  {bulkFailures.map((failure) => (
                    <li key={failure.label}>
                      {failure.label} — {failure.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {pendingLoading ? (
            <div className="empty-search">กำลังโหลด...</div>
          ) : visiblePending.length === 0 ? (
            <div className="empty-search">
              {pendingDate ? 'ไม่มีเอกสารรอดำเนินการในวันที่เลือก' : 'ไม่มีเอกสารรอดำเนินการ'}
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="เลือกทุกรายการที่รับได้"
                        checked={allSignableSelected}
                        onChange={toggleSelectAll}
                        disabled={bulkSigning || signablePending.length === 0}
                      />
                    </th>
                    <th>No.</th>
                    <th>วันที่รับ</th>
                    <th>เลขที่เอกสาร</th>
                    <th>ผู้ส่ง</th>
                    <th>เรื่อง</th>
                    <th>ผู้ส่งมอบ</th>
                    <th>วันที่ส่งมอบ</th>
                    <th>ผู้ตรวจสอบ</th>
                    <th>จัดซื้อ</th>
                    <th>ปลายทาง</th>
                    <th>ขั้นตอน</th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePending.map((doc: any) => {
                    const action = workflowAction(doc);
                    const eligibleForBulkReceive = canReceive(doc);
                    return (
                      <tr key={doc.id}>
                        <td>
                          {eligibleForBulkReceive && (
                            <input
                              type="checkbox"
                              aria-label={`เลือกเอกสารเลขที่ ${doc.running_no}`}
                              checked={selectedIds.has(doc.id)}
                              onChange={() => toggleSelect(doc.id)}
                              disabled={bulkSigning}
                            />
                          )}
                        </td>
                        <td className="code-cell">{doc.running_no}</td>
                        <td>{doc.received_date}</td>
                        <td>{doc.doc_number || '-'}</td>
                        <td>{doc.sender}</td>
                        <td>{doc.subject}</td>
                        <td>{doc.admin_signature || '-'}</td>
                        <td>{(doc.admin_signed_at || '').split('T')[0] || '-'}</td>
                        <td>{doc.inspector_signature || '-'}</td>
                        <td>{doc.purchasing_signature || '-'}</td>
                        <td>{doc.recipient_dept_name}</td>
                        <td>
                          {action ? (
                            <a href={`/recipient/${doc.id}`} className="table-action-button" style={{ textDecoration: 'none', display: 'inline-flex', padding: '6px 14px' }}>
                              ✍️ {ACTION_LABELS[action] || 'ดำเนินการ'}
                            </a>
                          ) : (
                            <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>หน่วยงานอื่น</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="scan-panel">
          <div className="search-panel" style={{ marginBottom: 16 }}>
            <div className="search-form">
              <div className="search-top-row">
                <div className="search-input-row">
                  <input
                    placeholder="ค้นหา ผู้ส่ง, เรื่อง, เลขที่เอกสาร..."
                    value={closedFilter.keyword}
                    onChange={(e) => setClosedFilter({ ...closedFilter, keyword: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && loadClosed()}
                  />
                </div>
                <input
                  type="date"
                  value={closedFilter.date_from}
                  onChange={(e) => setClosedFilter({ ...closedFilter, date_from: e.target.value })}
                  style={{ minHeight: 42 }}
                />
                <input
                  type="date"
                  value={closedFilter.date_to}
                  onChange={(e) => setClosedFilter({ ...closedFilter, date_to: e.target.value })}
                  style={{ minHeight: 42 }}
                />
                <button className="secondary-button" onClick={loadClosed} style={{ minHeight: 44 }}>
                  🔍 ค้นหา
                </button>
              </div>
            </div>
          </div>

          {closedLoading ? (
            <div className="empty-search">กำลังโหลด...</div>
          ) : closedDocs.length === 0 ? (
            <div className="empty-search">ไม่พบเอกสารที่ปิดงานแล้ว</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>วันที่รับ</th>
                    <th>เลขที่เอกสาร</th>
                    <th>ผู้ส่ง</th>
                    <th>เรื่อง</th>
                    <th>ผู้ส่งมอบ</th>
                    <th>ผู้ตรวจสอบ</th>
                    <th>จัดซื้อ</th>
                    <th>ปลายทาง</th>
                    <th>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {closedDocs.map((doc: any) => (
                    <tr key={doc.id}>
                      <td className="code-cell">{doc.running_no}</td>
                      <td>{doc.received_date}</td>
                      <td>{doc.doc_number || '-'}</td>
                      <td>{doc.sender}</td>
                      <td>{doc.subject}</td>
                      <td>{doc.admin_signature || '-'}</td>
                      <td>{doc.inspector_signature || '-'}</td>
                      <td>{doc.purchasing_signature || '-'}</td>
                      <td>{doc.recipient_dept_name}</td>
                      <td>
                        <span className="status-badge success">ปิดงานแล้ว</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showBulkSignModal && (
        <div className="scan-popup-overlay" role="presentation" onClick={() => !bulkSigning && setShowBulkSignModal(false)}>
          <form
            className="scan-popup-sheet"
            aria-modal="true"
            aria-labelledby="bulk-recipient-signature-title"
            role="dialog"
            style={{ maxWidth: 500, margin: '0 auto' }}
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              handleBulkSign();
            }}
          >
            <div className="scan-popup-handle" />
            <h3 id="bulk-recipient-signature-title" style={{ marginBottom: 12 }}>
              ✍️ ลงชื่อรับเอกสาร {selectedIds.size} รายการ
            </h3>
            <div className="form-group">
              <label htmlFor="bulk-recipient-signature">ชื่อผู้รับเอกสาร *</label>
              <input
                id="bulk-recipient-signature"
                type="text"
                value={bulkSignature}
                onChange={(event) => setBulkSignature(event.target.value)}
                placeholder="พิมพ์ชื่อผู้รับเอกสาร"
                maxLength={255}
                autoFocus
                style={{ fontFamily: 'Caveat, cursive', fontSize: '1.4rem', minHeight: 48 }}
              />
              <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: 4 }}>
                ชื่อนี้จะใช้เป็นลายเซ็นผู้รับของทุกรายการที่เลือก
              </div>
            </div>
            {bulkSignError && <div className="toast error" style={{ position: 'static', marginBottom: 8 }}>{bulkSignError}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button type="button" className="ghost-button" onClick={() => setShowBulkSignModal(false)} disabled={bulkSigning}>
                ยกเลิก
              </button>
              <button type="submit" className="secondary-button" disabled={bulkSigning}>
                {bulkSigning ? 'กำลังดำเนินการ...' : '✅ ยืนยันรับเอกสาร'}
              </button>
            </div>
            <button type="button" className="scan-popup-close" onClick={() => setShowBulkSignModal(false)} disabled={bulkSigning}>ปิด</button>
          </form>
        </div>
      )}
    </div>
  );
}
