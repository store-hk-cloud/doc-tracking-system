'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';

const todayStr = () => new Date().toISOString().split('T')[0];

export default function RecipientListPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'admin';

  const [tab, setTab] = useState<'pending' | 'closed'>('pending');

  // Pending tab
  const [pendingDocs, setPendingDocs] = useState<any[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingDate, setPendingDate] = useState(todayStr());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSigning, setBulkSigning] = useState(false);
  const [bulkMessage, setBulkMessage] = useState('');

  // Closed tab
  const [closedDocs, setClosedDocs] = useState<any[]>([]);
  const [closedLoading, setClosedLoading] = useState(false);
  const [closedLoaded, setClosedLoaded] = useState(false);
  const [closedFilter, setClosedFilter] = useState({ keyword: '', date_from: '', date_to: '' });

  const deptQuery = !isAdmin && profile?.department_id ? `&dept_id=${profile.department_id}` : '';

  const loadPending = async () => {
    setPendingLoading(true);
    try {
      const res = await window.fetch(`/api/documents?status=delivered${deptQuery}`);
      const data = await res.json();
      if (data.success) setPendingDocs(data.data.filter((d: any) => d.status === 'delivered'));
    } catch (e) {
      console.error('fetch pending docs error:', e);
    }
    setPendingLoading(false);
  };

  const loadClosed = async () => {
    setClosedLoading(true);
    try {
      let url = `/api/documents?status=closed&status=signed${deptQuery}`;
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

  const canSign = (doc: any) => !!profile?.department_id && profile.department_id === doc.recipient_dept_id;

  const visiblePending = pendingDocs.filter((d: any) => (d.admin_signed_at || '').split('T')[0] === pendingDate);
  const signablePending = visiblePending.filter(canSign);

  const toggleSelect = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((current) =>
      current.size === signablePending.length ? new Set() : new Set(signablePending.map((d: any) => d.id))
    );
  };

  const handleBulkSign = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`ยืนยันลงชื่อรับเอกสาร ${selectedIds.size} รายการ?`)) return;
    setBulkSigning(true);
    setBulkMessage('');
    const ids = Array.from(selectedIds);
    const results = await Promise.all(
      ids.map((id) =>
        window
          .fetch('/api/deliveries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ document_recipient_id: id, is_verified: true, verification_note: null }),
          })
          .then((r) => r.json())
          .catch(() => ({ success: false }))
      )
    );
    const okCount = results.filter((r: any) => r.success).length;
    const failCount = results.length - okCount;
    setBulkMessage(
      failCount > 0
        ? `✅ สำเร็จ ${okCount} รายการ, ❌ ล้มเหลว ${failCount} รายการ (อาจถูกดำเนินการไปแล้ว)`
        : `✅ ลงชื่อรับสำเร็จ ${okCount} รายการ`
    );
    setSelectedIds(new Set());
    setBulkSigning(false);
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
            {pendingDate !== todayStr() && (
              <button className="ghost-button" style={{ width: 'auto', padding: '0 12px' }} onClick={() => setPendingDate(todayStr())}>
                กลับไปวันนี้
              </button>
            )}
          </div>

          {selectedIds.size > 0 && (
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
              <span style={{ fontWeight: 700 }}>เลือกแล้ว {selectedIds.size} รายการ</span>
              <button className="secondary-button" style={{ width: 'auto', padding: '0 16px' }} onClick={handleBulkSign} disabled={bulkSigning}>
                {bulkSigning ? 'กำลังดำเนินการ...' : '✅ ลงชื่อรับทั้งหมด'}
              </button>
            </div>
          )}

          {bulkMessage && <div className="toast success" style={{ position: 'static', marginBottom: 12 }}>{bulkMessage}</div>}

          {pendingLoading ? (
            <div className="empty-search">กำลังโหลด...</div>
          ) : visiblePending.length === 0 ? (
            <div className="empty-search">ไม่มีเอกสารรอดำเนินการในวันที่เลือก</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={selectedIds.size === signablePending.length && signablePending.length > 0}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th>No.</th>
                    <th>วันที่รับ</th>
                    <th>เลขที่เอกสาร</th>
                    <th>ผู้ส่ง</th>
                    <th>เรื่อง</th>
                    <th>ผู้ส่งมอบ</th>
                    <th>ผู้ตรวจสอบ</th>
                    <th>จัดซื้อ</th>
                    <th>ปลายทาง</th>
                    <th>ดำเนินการ</th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePending.map((doc: any) => {
                    const eligible = canSign(doc);
                    return (
                      <tr key={doc.id}>
                        <td>
                          {eligible && (
                            <input type="checkbox" checked={selectedIds.has(doc.id)} onChange={() => toggleSelect(doc.id)} />
                          )}
                        </td>
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
                          {eligible ? (
                            <a href={`/recipient/${doc.id}`} className="table-action-button" style={{ textDecoration: 'none', display: 'inline-flex', padding: '6px 14px' }}>
                              ✍️ ลงชื่อรับ
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
    </div>
  );
}
