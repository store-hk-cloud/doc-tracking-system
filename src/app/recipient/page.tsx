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
// ชื่อช่องลายเซ็นที่ต้องกรอกในแต่ละขั้น ใช้ทั้งใน popup เดี่ยวและตอนกดหลายรายการ
const ACTION_SIGNATURE_LABELS: Record<string, string> = {
  inspector: 'ชื่อผู้ตรวจสอบ',
  purchasing: 'ชื่อจัดซื้อ',
  recipient: 'ชื่อผู้รับเอกสาร',
};
const STAGE_LABELS: Record<string, string> = {
  awaiting_inspector: 'รอผู้ตรวจสอบ',
  awaiting_purchasing: 'รอจัดซื้อ',
  awaiting_recipient: 'รอผู้รับ',
  delivered: 'รอลงชื่อรับ',
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
  const [pendingKeyword, setPendingKeyword] = useState('');
  const [pendingStage, setPendingStage] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSigning, setBulkSigning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [bulkMessage, setBulkMessage] = useState('');
  const [bulkFailures, setBulkFailures] = useState<{ label: string; error: string }[]>([]);
  const [showBulkSignModal, setShowBulkSignModal] = useState(false);
  const [bulkSignature, setBulkSignature] = useState('');
  const [bulkSignError, setBulkSignError] = useState('');

  // popup ลงนามรายการเดียว: เดิมกดปุ่มในตารางแล้วเด้งไป /recipient/[id] ซึ่งทำให้
  // เสียคิวงานที่เลื่อนหาไว้ แล้วต้องกด back กลับมาเองทุกใบ
  const [signTarget, setSignTarget] = useState<any>(null);
  const [signAction, setSignAction] = useState('');
  const [signSignature, setSignSignature] = useState('');
  const [signVerified, setSignVerified] = useState(true);
  const [signNote, setSignNote] = useState('');
  const [signSubmitting, setSignSubmitting] = useState(false);
  const [signError, setSignError] = useState('');
  const [signEditing, setSignEditing] = useState(false);

  // Closed tab
  const [closedDocs, setClosedDocs] = useState<any[]>([]);
  const [closedLoading, setClosedLoading] = useState(false);
  const [closedLoaded, setClosedLoaded] = useState(false);
  const [closedFilter, setClosedFilter] = useState({ keyword: '', dept_id: '', date_from: '', date_to: '' });
  const [departments, setDepartments] = useState<any[]>([]);

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
      if (closedFilter.dept_id) url += `&dept_id=${closedFilter.dept_id}`;
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
    window.fetch('/api/departments').then((r) => r.json()).then((data) => {
      if (data.success) setDepartments(data.data);
    });
  }, []);

  useEffect(() => {
    if (tab === 'closed' && !closedLoaded) loadClosed();
  }, [tab]);

  const workflowAction = (doc: any) => isGoodsReceipt(doc.subject)
    ? getGoodsReceiptWorkflowAction(profile?.department_code, doc.status)
    : profile?.department_id === doc.recipient_dept_id && doc.status === 'delivered' ? 'recipient' : null;

  const visiblePending = pendingDocs.filter((d: any) => {
    if (pendingDate && (d.admin_signed_at || '').split('T')[0] !== pendingDate) return false;
    if (pendingStage && d.status !== pendingStage) return false;
    if (pendingKeyword) {
      const keyword = pendingKeyword.toLowerCase();
      const haystack = [d.sender, d.subject, d.doc_number, d.running_no].join(' ').toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
  // getGoodsReceiptWorkflowAction คืน 'inspector' ทั้งตอน awaiting_inspector (งานที่รอ)
  // และ awaiting_purchasing (เปิดให้ย้อนแก้ชื่อที่เซ็นไว้แล้ว) เหมือนกัน ถ้านับรวมเข้า
  // "เลือกทั้งหมด" การกดครั้งเดียวจะทับลายเซ็นที่เก็บมาแล้วทั้งกอง — เลือกเป็นชุดได้
  // เฉพาะขั้นที่ยังรอตัวเองจริง ส่วนการย้อนแก้ยังทำได้ทีละใบจากปุ่มในตาราง
  const isPendingOwnStage = (doc: any) => {
    const action = workflowAction(doc);
    if (action === 'inspector') return doc.status === 'awaiting_inspector';
    if (action === 'purchasing') return doc.status === 'awaiting_purchasing';
    return action === 'recipient';
  };

  // เลือกได้ทุกใบที่เป็นงานของตัวเอง ไม่ใช่เฉพาะขั้น "ลงชื่อรับ" เพราะคนคนเดียว
  // มีทั้งใบที่รอเซ็นผู้ตรวจสอบและใบที่รอลงชื่อรับค้างอยู่พร้อมกันได้
  const signablePending = visiblePending.filter(isPendingOwnStage);
  const allSignableSelected = signablePending.length > 0 && signablePending.every((d: any) => selectedIds.has(d.id));
  const selectedByAction = signablePending
    .filter((d: any) => selectedIds.has(d.id))
    .reduce((acc: Record<string, number>, d: any) => {
      const action = workflowAction(d) as string;
      acc[action] = (acc[action] || 0) + 1;
      return acc;
    }, {});
  // ขั้นต่างกันใช้ช่องลายเซ็นชื่อต่างกัน ถ้าเลือกคละขั้นจะเรียกชื่อรวมว่า "ชื่อผู้ลงนาม"
  const selectedActionKeys = Object.keys(selectedByAction);
  const bulkSignatureLabel = selectedActionKeys.length === 1
    ? ACTION_SIGNATURE_LABELS[selectedActionKeys[0]]
    : 'ชื่อผู้ลงนาม';
  const bulkConfirmLabel = selectedActionKeys.length === 1
    ? (selectedActionKeys[0] === 'recipient' ? '✅ ยืนยันรับเอกสาร'
      : selectedActionKeys[0] === 'inspector' ? '✅ ยืนยันผู้ตรวจสอบ' : '✅ ยืนยันจัดซื้อ')
    : '✅ ยืนยันลงนามทั้งหมด';

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

  // ส่งคำขอลงนามหนึ่งใบตามขั้นของใบนั้น — ใช้ร่วมกันทั้ง popup เดี่ยวและแบบหลายรายการ
  // เพื่อไม่ให้กติกาของสองทางเดินแตกต่างกันเงียบ ๆ
  const submitSignature = async (
    doc: any,
    action: string,
    signature: string,
    options: { verified: boolean; note: string },
  ) => {
    if (action === 'recipient') {
      return window.fetch('/api/deliveries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_recipient_id: doc.id,
          is_verified: options.verified,
          recipient_signature: signature,
          verification_note: options.verified ? null : options.note,
        }),
      });
    }
    const field = action === 'inspector' ? 'inspector_signature' : 'purchasing_signature';
    return window.fetch(`/api/documents/${doc.id}/sign`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: signature }),
    });
  };

  const openSignModal = (doc: any, action: string) => {
    const editing = !isPendingOwnStage(doc);
    setSignTarget(doc);
    setSignAction(action);
    setSignEditing(editing);
    const previous = action === 'inspector' ? doc.inspector_signature : doc.purchasing_signature;
    setSignSignature((editing && previous) || profile?.full_name || '');
    setSignVerified(true);
    setSignNote('');
    setSignError('');
  };

  const closeSignModal = () => {
    if (signSubmitting) return;
    setSignTarget(null);
    setSignAction('');
    setSignError('');
  };

  const handleSingleSign = async () => {
    const signature = signSignature.trim();
    if (!signature) {
      setSignError(`กรุณาระบุ${ACTION_SIGNATURE_LABELS[signAction] || 'ชื่อผู้ลงนาม'}`);
      return;
    }
    if (signAction === 'recipient' && !signVerified && !signNote.trim()) {
      setSignError('กรุณาระบุสาเหตุที่เอกสารไม่ถูกต้อง');
      return;
    }
    setSignSubmitting(true);
    setSignError('');
    try {
      const res = await submitSignature(signTarget, signAction, signature, { verified: signVerified, note: signNote.trim() });
      const data = await res.json().catch(() => ({}));
      if (!data?.success) {
        setSignError(data?.error || `ไม่สำเร็จ (HTTP ${res.status})`);
        setSignSubmitting(false);
        return;
      }
      setBulkFailures([]);
      setBulkMessage(
        signAction === 'recipient'
          ? (signVerified ? `✅ ลงชื่อรับเลขที่ ${signTarget.running_no} เรียบร้อย` : `⚠️ แจ้งปัญหาเลขที่ ${signTarget.running_no} เรียบร้อย`)
          : `✅ บันทึก${ACTION_SIGNATURE_LABELS[signAction]}เลขที่ ${signTarget.running_no} แล้ว`
      );
      // ปิด popup แล้วกลับมาที่คิวงานทันที พร้อมโหลดรายการใหม่ให้สถานะตรงกับ DB
      setSignTarget(null);
      setSignAction('');
      setSignSubmitting(false);
      await loadPending();
      setClosedLoaded(false);
    } catch (e: any) {
      setSignError(e?.message || 'ส่งคำขอไม่สำเร็จ');
      setSignSubmitting(false);
    }
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
      setBulkSignError(`กรุณาระบุ${bulkSignatureLabel}`);
      return;
    }
    const targets = signablePending.filter((d: any) => selectedIds.has(d.id));
    setBulkSigning(true);
    setBulkSignError('');
    setBulkMessage('');
    setBulkFailures([]);
    setBulkProgress({ done: 0, total: targets.length });
    setShowBulkSignModal(false);

    // แบบหลายรายการลงนามว่า "ถูกต้อง" เท่านั้น การแจ้งปัญหาต้องระบุสาเหตุรายใบ
    // จึงเปิดเป็น popup รายการเดียวแทน
    const receiveOne = async (doc: any) => {
      const label = `เลขที่ ${doc.running_no} (${ACTION_LABELS[workflowAction(doc) as string] || 'ดำเนินการ'})`;
      try {
        const res = await submitSignature(doc, workflowAction(doc) as string, recipientSignature, { verified: true, note: '' });
        const data = await res.json().catch(() => ({}));
        if (!data?.success) {
          return { ok: false, label, error: data?.error || `HTTP ${res.status}` };
        }
        return { ok: true };
      } catch (e: any) {
        return { ok: false, label, error: e?.message || 'ส่งคำขอไม่สำเร็จ' };
      }
    };

    // ยิงทุกใบพร้อมกัน ให้เหมือนหน้าส่งมอบ (ตามที่ผู้ใช้สั่ง)
    //
    // เดิมจำกัดไว้ 4 คำขอเพราะฝั่งเซิร์ฟเวอร์ต้องอ่านทุกแท็บของ Google Sheets ต่อ
    // หนึ่งใบเพื่อหาแถวของเอกสารนั้น ยิงพร้อมกันหลายสิบใบจึงชนโควตาได้ แต่ตอนนี้การ
    // sync Sheets เป็น best-effort แล้ว (api/deliveries/route.ts) ถ้าชนโควตาเอกสารยัง
    // ถูกรับสำเร็จ เสียแค่แถวใน Sheets ไม่ถูกอัปเดต ความเสียหายจึงจำกัดอยู่ที่กระจก
    // ไม่ใช่ฐานข้อมูล — ส่วนใบที่ไม่สำเร็จจริงยังถูกรายงานรายใบด้านล่าง
    const failures: { label: string; error: string }[] = [];
    let okCount = 0;
    await Promise.all(targets.map(async (doc: any) => {
      const result = await receiveOne(doc);
      if (result.ok) okCount += 1;
      else failures.push({ label: result.label!, error: result.error! });
      setBulkProgress((current) => ({ ...current, done: current.done + 1 }));
    }));

    setBulkMessage(
      failures.length > 0
        ? `ลงนามสำเร็จ ${okCount} รายการ · ไม่สำเร็จ ${failures.length} รายการ`
        : `✅ ลงนามสำเร็จ ${okCount} รายการ`
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
          <div className="search-panel" style={{ marginBottom: 16 }}>
            <div className="search-form">
              <div className="search-top-row">
                <div className="search-input-row">
                  <input
                    placeholder="ค้นหา ผู้ส่ง, เรื่อง, เลขที่เอกสาร..."
                    value={pendingKeyword}
                    onChange={(e) => setPendingKeyword(e.target.value)}
                  />
                </div>
                <select
                  value={pendingStage}
                  onChange={(e) => setPendingStage(e.target.value)}
                  style={{ minHeight: 42, borderRadius: 8, border: '1px solid var(--line-strong)', padding: '0 10px' }}
                >
                  <option value="">ทุกขั้นตอน</option>
                  {Object.entries(STAGE_LABELS).map(([status, label]) => (
                    <option key={status} value={status}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

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
                {selectedIds.size > 0 ? `เลือกแล้ว ${selectedIds.size} รายการ` : `งานของคุณ ${signablePending.length} รายการ`}
              </span>
              {selectedIds.size > 0 && selectedActionKeys.length > 0 && (
                <span style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
                  {selectedActionKeys.map((action) => `${ACTION_LABELS[action]} ${selectedByAction[action]}`).join(' · ')}
                </span>
              )}
              <button
                className="secondary-button"
                style={{ width: 'auto', padding: '0 16px' }}
                onClick={openBulkSignModal}
                disabled={bulkSigning || selectedIds.size === 0}
              >
                {bulkSigning
                  ? `กำลังดำเนินการ ${bulkProgress.done}/${bulkProgress.total}`
                  : selectedIds.size > 0 ? `✅ ลงนาม ${selectedIds.size} รายการ` : '✅ ลงนามที่เลือก'}
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
                        aria-label="เลือกทุกรายการที่เป็นงานของคุณ"
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
                    return (
                      <tr key={doc.id}>
                        <td>
                          {isPendingOwnStage(doc) && (
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
                            <button
                              type="button"
                              className="table-action-button"
                              style={{ padding: '6px 14px' }}
                              onClick={() => openSignModal(doc, action)}
                              disabled={bulkSigning}
                            >
                              {isPendingOwnStage(doc)
                                ? `✍️ ${ACTION_LABELS[action] || 'ดำเนินการ'}`
                                : `✏️ แก้ไข${action === 'inspector' ? 'ผู้ตรวจสอบ' : 'จัดซื้อ'}`}
                            </button>
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
                <select
                  value={closedFilter.dept_id}
                  onChange={(e) => setClosedFilter({ ...closedFilter, dept_id: e.target.value })}
                  style={{ minHeight: 42, borderRadius: 8, border: '1px solid var(--line-strong)', padding: '0 10px' }}
                >
                  <option value="">ทุกหน่วยงาน</option>
                  {departments.map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
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
              ✍️ ลงนาม {selectedIds.size} รายการ
            </h3>
            {selectedActionKeys.length > 0 && (
              <div style={{ marginBottom: 12, color: 'var(--muted)', fontSize: '0.85rem' }}>
                {selectedActionKeys.map((action) => `${ACTION_LABELS[action]} ${selectedByAction[action]} รายการ`).join(' · ')}
              </div>
            )}
            <div className="form-group">
              <label htmlFor="bulk-recipient-signature">{bulkSignatureLabel} *</label>
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
                ชื่อนี้จะใช้เป็นลายเซ็นของทุกรายการที่เลือก · ทุกรายการถูกบันทึกว่า &quot;ถูกต้อง&quot;
                ถ้าใบใดมีปัญหาให้กดปุ่มในตารางเพื่อแจ้งแยกรายการ
              </div>
            </div>
            {bulkSignError && <div className="toast error" style={{ position: 'static', marginBottom: 8 }}>{bulkSignError}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button type="button" className="ghost-button" onClick={() => setShowBulkSignModal(false)} disabled={bulkSigning}>
                ยกเลิก
              </button>
              <button type="submit" className="secondary-button" disabled={bulkSigning}>
                {bulkSigning ? 'กำลังดำเนินการ...' : bulkConfirmLabel}
              </button>
            </div>
            <button type="button" className="scan-popup-close" onClick={() => setShowBulkSignModal(false)} disabled={bulkSigning}>ปิด</button>
          </form>
        </div>
      )}

      {signTarget && (
        <div className="scan-popup-overlay" role="presentation" onClick={closeSignModal}>
          <form
            className="scan-popup-sheet"
            aria-modal="true"
            aria-labelledby="single-sign-title"
            role="dialog"
            style={{ maxWidth: 520, margin: '0 auto' }}
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              handleSingleSign();
            }}
          >
            <div className="scan-popup-handle" />
            <h3 id="single-sign-title" style={{ marginBottom: 12 }}>
              {signEditing
                ? `✏️ แก้ไข${signAction === 'inspector' ? 'ชื่อผู้ตรวจสอบ' : 'ชื่อจัดซื้อ'}`
                : `✍️ ${ACTION_LABELS[signAction] || 'ดำเนินการ'}`} — เลขที่ {signTarget.running_no}
            </h3>
            {signEditing && (
              <div className="toast warning" style={{ position: 'static', marginBottom: 12 }}>
                ใบนี้ผ่านขั้นของคุณไปแล้ว การยืนยันจะเขียนทับชื่อเดิมและบันทึกไว้ในประวัติการแก้ไข
              </div>
            )}

            <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
              <div className="field-control">
                <span>ผู้ส่ง</span>
                <div style={{ fontWeight: 700 }}>{signTarget.sender}</div>
              </div>
              <div className="field-control">
                <span>เรื่อง</span>
                <div style={{ fontWeight: 700 }}>{signTarget.subject}</div>
              </div>
              <div className="form-row">
                <div className="field-control">
                  <span>เลขที่เอกสาร</span>
                  <div style={{ fontWeight: 700 }}>{signTarget.doc_number || '-'}</div>
                </div>
                <div className="field-control">
                  <span>ขั้นตอนปัจจุบัน</span>
                  <div style={{ fontWeight: 700 }}>{STAGE_LABELS[signTarget.status] || signTarget.status}</div>
                </div>
              </div>
              <div className="field-control">
                <span>ปลายทาง</span>
                <div style={{ fontWeight: 700 }}>{signTarget.recipient_dept_name}</div>
              </div>
              {signTarget.inspector_signature && (
                <div className="field-control">
                  <span>ผู้ตรวจสอบ</span>
                  <div style={{ fontWeight: 700 }}>{signTarget.inspector_signature}</div>
                </div>
              )}
              {signTarget.note && (
                <div className="field-control">
                  <span>หมายเหตุ</span>
                  <div style={{ fontWeight: 700, color: 'var(--text)' }}>{signTarget.note}</div>
                </div>
              )}
            </div>

            {/* การตรวจถูกต้อง/ไม่ถูกต้องมีเฉพาะขั้นลงชื่อรับ ขั้นผู้ตรวจสอบและจัดซื้อ
                เป็นการรับรองลำดับงาน ไม่มีทางเดินแจ้งปัญหาในฝั่ง API */}
            {signAction === 'recipient' && (
              <div className="form-group">
                <label>✅ ตรวจสอบความถูกต้อง</label>
                <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                  <button
                    type="button"
                    className={signVerified ? 'secondary-button' : 'ghost-button'}
                    onClick={() => { setSignVerified(true); setSignNote(''); }}
                    style={{ flex: 1, minHeight: 44 }}
                  >
                    ✅ ถูกต้อง
                  </button>
                  <button
                    type="button"
                    className={!signVerified ? 'secondary-button' : 'ghost-button'}
                    onClick={() => setSignVerified(false)}
                    style={{ flex: 1, minHeight: 44, background: !signVerified ? 'var(--danger)' : undefined, borderColor: 'var(--danger)' }}
                  >
                    ❌ ไม่ถูกต้อง
                  </button>
                </div>
              </div>
            )}

            {signAction === 'recipient' && !signVerified && (
              <div className="form-group">
                <label htmlFor="single-sign-note">สาเหตุ *</label>
                <textarea
                  id="single-sign-note"
                  value={signNote}
                  onChange={(event) => setSignNote(event.target.value)}
                  placeholder="ระบุรายละเอียดปัญหา..."
                />
              </div>
            )}

            <div className="form-group">
              <label htmlFor="single-sign-signature">{ACTION_SIGNATURE_LABELS[signAction] || 'ชื่อผู้ลงนาม'} *</label>
              <input
                id="single-sign-signature"
                type="text"
                value={signSignature}
                onChange={(event) => setSignSignature(event.target.value)}
                placeholder={`พิมพ์${ACTION_SIGNATURE_LABELS[signAction] || 'ชื่อผู้ลงนาม'}`}
                maxLength={255}
                autoFocus
                style={{ fontFamily: 'Caveat, cursive', fontSize: '1.4rem', minHeight: 48 }}
              />
              <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: 4 }}>
                {signEditing ? 'แสดงชื่อที่บันทึกไว้เดิม แก้เป็นชื่อที่ถูกต้องได้' : 'เติมชื่อจากบัญชีที่ล็อกอินไว้ให้แล้ว แก้เป็นชื่อผู้ลงนามตัวจริงได้'}
                {profile?.full_name && signSignature.trim() && signSignature.trim() !== profile.full_name && (
                  <> · บันทึกว่าบัญชี {profile.full_name} เป็นผู้กดยืนยัน</>
                )}
              </div>
            </div>

            {signError && <div className="toast error" style={{ position: 'static', marginBottom: 8 }}>{signError}</div>}

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button type="button" className="ghost-button" onClick={closeSignModal} disabled={signSubmitting}>
                ยกเลิก
              </button>
              <button type="submit" className="secondary-button" disabled={signSubmitting}>
                {signSubmitting
                  ? 'กำลังดำเนินการ...'
                  : signAction === 'recipient'
                    ? (signVerified ? '✅ ยืนยันรับเอกสาร' : '⚠️ แจ้งปัญหา')
                    : `✅ ยืนยัน${signAction === 'inspector' ? 'ผู้ตรวจสอบ' : 'จัดซื้อ'}`}
              </button>
            </div>
            <button type="button" className="scan-popup-close" onClick={closeSignModal} disabled={signSubmitting}>ปิด</button>
          </form>
        </div>
      )}
    </div>
  );
}
