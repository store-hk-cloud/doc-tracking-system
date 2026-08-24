'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';

const STATUS_OPTIONS = ['ทั้งหมด', 'registered', 'delivered', 'awaiting_inspector', 'awaiting_purchasing', 'awaiting_recipient', 'signed', 'closed', 'rejected'];
const STATUS_LABELS: Record<string, string> = {
  'ทั้งหมด': 'ทั้งหมด',
  registered: 'ลงทะเบียน',
  delivered: 'ส่งมอบแล้ว',
  awaiting_inspector: 'รอผู้ตรวจสอบ',
  awaiting_purchasing: 'รอจัดซื้อ',
  awaiting_recipient: 'รอผู้รับ',
  signed: 'ลงนามแล้ว',
  closed: 'ปิดงานแล้ว',
  rejected: 'แจ้งปัญหา',
};
const STATUS_COLORS: Record<string, string> = {
  registered: '',
  delivered: ' success',
  awaiting_inspector: '',
  awaiting_purchasing: '',
  awaiting_recipient: '',
  signed: ' success',
  closed: ' success',
  rejected: ' error',
};
// สถานะที่แปลว่าเอกสารออกจากมือผู้ส่งแล้วแต่ยังไม่จบ — ใช้นับวันที่ค้างเท่านั้น
const IN_FLIGHT_STATUSES = new Set(['delivered', 'awaiting_inspector', 'awaiting_purchasing', 'awaiting_recipient', 'rejected']);
const PAGE_SIZE = 100;

function daysPending(doc: any): number | null {
  if (!doc.admin_signed_at || !IN_FLIGHT_STATUSES.has(doc.status)) return null;
  return Math.floor((Date.now() - new Date(doc.admin_signed_at).getTime()) / 86400000);
}

function formatDate(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' });
}

export default function TrackingPage() {
  const { profile, user } = useAuth();
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState({ status: '', keyword: '', dept_id: '' });
  const [onlyMine, setOnlyMine] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [departments, setDepartments] = useState<any[]>([]);
  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'admin';
  const isSuperAdmin = profile?.role === 'super_admin';
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [signedCount, setSignedCount] = useState<number | null>(null);
  const [closingAll, setClosingAll] = useState(false);
  const [closeAllMessage, setCloseAllMessage] = useState('');
  const [closeAllFailed, setCloseAllFailed] = useState(false);
  // คำขอที่ยิงทีหลังต้องชนะเสมอ ไม่งั้นผลของคำค้นเก่าที่กลับมาช้ากว่าจะทับผลล่าสุด
  const requestSeq = useRef(0);

  useEffect(() => {
    window.fetch('/api/departments')
      .then((r) => r.json())
      .then((data) => { if (data.success) setDepartments(data.data); })
      .catch(() => {});
  }, []);

  const loadSignedCount = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await window.fetch('/api/documents?status=signed');
      const data = await res.json();
      if (data.success) setSignedCount(data.data.filter((d: any) => d.delivery_log_id).length);
    } catch {
      setSignedCount(null);
    }
  }, [isAdmin]);

  useEffect(() => { loadSignedCount(); }, [loadSignedCount]);

  const loadDocs = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadError('');
    let url = '/api/documents?';
    if (filter.status) url += `status=${filter.status}&`;
    if (filter.keyword) url += `keyword=${encodeURIComponent(filter.keyword)}&`;
    if (filter.dept_id) url += `dept_id=${filter.dept_id}&`;
    // ปล่อยให้ API กรองตามขั้น workflow เพื่อให้คลังสินค้า/FAC-PP และจัดซื้อ
    // เห็นเฉพาะใบรับสินค้าที่ถึงคิว แม้ recipient task อยู่ที่บัญชี.

    try {
      const res = await window.fetch(url);
      const data = await res.json();
      if (seq !== requestSeq.current) return;
      if (data.success) {
        setDocs(data.data);
        setVisibleCount(PAGE_SIZE);
      } else {
        setDocs([]);
        setLoadError(data.error || 'โหลดข้อมูลไม่สำเร็จ');
      }
    } catch {
      if (seq !== requestSeq.current) return;
      setDocs([]);
      setLoadError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่');
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [filter.status, filter.keyword, filter.dept_id]);

  // โหลดใหม่อัตโนมัติเมื่อเปลี่ยนสถานะหรือหน่วยงาน ส่วนคำค้นรอให้กดค้นหาเอง จึงไม่
  // ใส่ loadDocs (ซึ่งเปลี่ยนตัวตนทุกครั้งที่พิมพ์) ลงใน deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadDocs(); }, [filter.status, filter.dept_id]);

  const handleDeleteDoc = async (doc: any) => {
    if (!window.confirm(`⚠️ ลบเอกสาร #${doc.running_no} "${doc.subject}"?`)) return;
    try {
      const res = await window.fetch(`/api/documents/${doc.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) {
        window.alert(data.error || 'ลบเอกสารไม่สำเร็จ');
        return;
      }
      setDocs((current) => current.filter((d: any) => d.id !== doc.id));
      setSelectedDoc((current: any) => (current && current.id === doc.id ? null : current));
      await loadSignedCount();
    } catch {
      window.alert('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่');
    }
  };

  const handleCloseTask = async (doc: any) => {
    if (!doc.delivery_log_id) return;
    if (!window.confirm(`ปิดงานเอกสาร #${doc.running_no} "${doc.subject}"?`)) return;
    try {
      const res = await window.fetch(`/api/deliveries/${doc.delivery_log_id}/verify`, { method: 'PUT' });
      const data = await res.json();
      if (!data.success) {
        window.alert(data.error || 'เกิดข้อผิดพลาด');
        return;
      }
      setDocs((current) => current.map((d: any) => (d.id === doc.id ? { ...d, status: 'closed' } : d)));
      setSelectedDoc((current: any) => (current && current.id === doc.id ? { ...current, status: 'closed' } : current));
      await loadSignedCount();
    } catch {
      window.alert('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่');
    }
  };

  const handleCloseAllSigned = async () => {
    setCloseAllMessage('');
    setCloseAllFailed(false);
    let targets: any[] = [];
    try {
      const res = await window.fetch('/api/documents?status=signed');
      const data = await res.json();
      if (!data.success) {
        setCloseAllFailed(true);
        setCloseAllMessage(data.error || 'ดึงรายการที่รอปิดงานไม่สำเร็จ');
        return;
      }
      targets = data.data.filter((d: any) => d.delivery_log_id);
    } catch {
      setCloseAllFailed(true);
      setCloseAllMessage('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่');
      return;
    }
    if (targets.length === 0) {
      setSignedCount(0);
      return;
    }
    if (!window.confirm(`ปิดงานเอกสารที่ลงลายเซ็นผู้รับแล้วทั้งหมด ${targets.length} รายการ?`)) return;
    setClosingAll(true);
    const results = await Promise.all(
      targets.map((d: any) =>
        window
          .fetch(`/api/deliveries/${d.delivery_log_id}/verify`, { method: 'PUT' })
          .then((r) => r.json())
          .catch(() => ({ success: false }))
      )
    );
    const okCount = results.filter((r: any) => r.success).length;
    const failCount = results.length - okCount;
    setCloseAllFailed(failCount > 0);
    setCloseAllMessage(
      failCount > 0
        ? `✅ ปิดงานสำเร็จ ${okCount} รายการ, ❌ ล้มเหลว ${failCount} รายการ`
        : `✅ ปิดงานสำเร็จ ${okCount} รายการ`
    );
    setClosingAll(false);
    await loadSignedCount();
    await loadDocs();
  };

  const handleRedeliver = async (doc: any) => {
    if (!window.confirm(`ส่งเอกสาร #${doc.running_no} ให้ผู้รับเซ็นใหม่?`)) return;
    try {
      const res = await window.fetch(`/api/documents/${doc.id}/redeliver`, { method: 'PUT' });
      const data = await res.json();
      if (!data.success) {
        window.alert(data.error || 'เกิดข้อผิดพลาด');
        return;
      }
      setDocs((current) => current.map((d: any) => (d.id === doc.id ? { ...d, status: data.data.status } : d)));
      setSelectedDoc(null);
    } catch {
      window.alert('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่');
    }
  };

  // recorded_by ติดมากับทุกแถวของ /api/documents อยู่แล้ว จึงสลับมุมมองได้ฝั่ง
  // client ไม่ต้องยิง API ซ้ำ
  const visibleDocs = onlyMine ? docs.filter((d: any) => d.recorded_by === user?.id) : docs;
  const pagedDocs = visibleDocs.slice(0, visibleCount);

  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [onlyMine]);

  useEffect(() => {
    if (!selectedDoc) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedDoc(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedDoc]);

  return (
    <div>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="title-badge">🔍 ติดตาม</div>
        <h2>ติดตามสถานะเอกสาร</h2>
        <div className="title-accent" />
      </div>

      {/* Filters */}
      <div className="search-panel">
        <div className="search-form">
          <div className="search-top-row">
            <div className="search-input-row">
              <input
                placeholder="ค้นหา ผู้ส่ง, เรื่อง, เลขที่เอกสาร..."
                value={filter.keyword}
                onChange={(e) => setFilter({ ...filter, keyword: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && loadDocs()}
              />
            </div>
            {isAdmin && (
              <select value={filter.dept_id} onChange={(e) => setFilter({ ...filter, dept_id: e.target.value })} style={{ minHeight: 42, borderRadius: 8, border: '1px solid var(--line-strong)', padding: '0 10px' }}>
                <option value="">ทุกหน่วยงาน</option>
                {departments.map((d: any) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            )}
            <button className="secondary-button" onClick={loadDocs} style={{ minHeight: 44 }}>
              🔍 ค้นหา
            </button>
          </div>
          <div className="segmented-control search-status-row">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s}
                className={filter.status === (s === 'ทั้งหมด' ? '' : s) ? 'active' : ''}
                onClick={() => setFilter({ ...filter, status: s === 'ทั้งหมด' ? '' : s })}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          <div className="tracking-scope-row">
            <span className="eyebrow">ผู้ส่งมอบ</span>
            <div className="segmented-control">
              <button className={onlyMine ? '' : 'active'} onClick={() => setOnlyMine(false)}>ทุกคน</button>
              <button className={onlyMine ? 'active' : ''} onClick={() => setOnlyMine(true)}>ที่ฉันส่งมอบ</button>
            </div>
          </div>

          {isAdmin && signedCount !== null && signedCount > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                marginTop: 12,
                padding: '10px 14px',
                background: 'var(--primary-soft)',
                borderRadius: 8,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontWeight: 700 }}>
                มีเอกสารที่ลงลายเซ็นผู้รับแล้ว {signedCount} รายการ ยังไม่ถูกปิดงาน (รวมเอกสารเก่า)
              </span>
              <button className="secondary-button" style={{ width: 'auto', padding: '0 16px' }} onClick={handleCloseAllSigned} disabled={closingAll}>
                {closingAll ? 'กำลังปิดงาน...' : '🔒 ปิดงานทั้งหมด'}
              </button>
            </div>
          )}
          {closeAllMessage && (
            <div className={`toast ${closeAllFailed ? 'error' : 'success'}`} style={{ position: 'static', marginTop: 12 }}>
              {closeAllMessage}
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="report-panel">
        {loading ? (
          <div className="empty-search">กำลังโหลด...</div>
        ) : loadError ? (
          <div className="toast error" style={{ position: 'static' }}>
            {loadError}{' '}
            <button className="ghost-button" style={{ width: 'auto', minHeight: 32, marginLeft: 8 }} onClick={loadDocs}>ลองใหม่</button>
          </div>
        ) : visibleDocs.length === 0 ? (
          <div className="empty-search">{onlyMine ? 'ไม่พบเอกสารที่คุณส่งมอบ' : 'ไม่พบเอกสาร'}</div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>วันที่รับ</th>
                    <th>ผู้ส่ง</th>
                    <th>เลขที่เอกสาร</th>
                    <th>เรื่อง</th>
                    <th>หน่วยงาน</th>
                    <th>สถานะ</th>
                    <th>ส่งมอบเมื่อ</th>
                    <th>ค้าง</th>
                    <th>ลายเซ็น Admin</th>
                    <th>ผู้ตรวจสอบ</th>
                    <th>จัดซื้อ</th>
                    <th>ลายเซ็นผู้รับ</th>
                    {isSuperAdmin && <th>ลบ</th>}
                  </tr>
                </thead>
                <tbody>
                  {pagedDocs.map((doc: any) => {
                    const pending = daysPending(doc);
                    return (
                      <tr
                        key={doc.id}
                        tabIndex={0}
                        role="button"
                        aria-label={`ดูรายละเอียดเอกสาร ${doc.running_no} ${doc.subject}`}
                        onClick={() => setSelectedDoc(doc)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedDoc(doc);
                          }
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <td className="code-cell">{doc.running_no}</td>
                        <td>{doc.received_date}</td>
                        <td>{doc.sender}</td>
                        <td>{doc.doc_number || '-'}</td>
                        <td>{doc.subject}</td>
                        <td>{doc.recipient_dept_name}</td>
                        <td>
                          <span className={`status-badge${STATUS_COLORS[doc.status] || ''}`}>
                            {STATUS_LABELS[doc.status] || doc.status}
                          </span>
                        </td>
                        <td>{formatDate(doc.admin_signed_at)}</td>
                        <td>{pending === null ? '-' : `${pending} วัน`}</td>
                        <td>{doc.admin_signature || '-'}</td>
                        <td>{doc.inspector_signature || '-'}</td>
                        <td>{doc.purchasing_signature || '-'}</td>
                        <td>{doc.recipient_signature || '-'}</td>
                        {isSuperAdmin && (
                          <td>
                            <button
                              className="table-action-button danger"
                              onClick={(e) => { e.stopPropagation(); handleDeleteDoc(doc); }}
                            >
                              🗑
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: '0.85rem', fontWeight: 700 }}>
              พบทั้งหมด {visibleDocs.length} รายการ{visibleDocs.length > pagedDocs.length ? ` (แสดง ${pagedDocs.length} รายการแรก)` : ''}
            </div>
            {visibleDocs.length > pagedDocs.length && (
              <button
                className="ghost-button"
                style={{ marginTop: 12 }}
                onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}
              >
                แสดงเพิ่ม (เหลืออีก {visibleDocs.length - pagedDocs.length} รายการ)
              </button>
            )}
          </>
        )}
      </div>

      {/* Modal */}
      {selectedDoc && (
        <div className="scan-popup-overlay" role="presentation" onClick={() => setSelectedDoc(null)}>
          <div
            className="scan-popup-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tracking-detail-title"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 520, margin: '0 auto' }}
          >
            <div className="scan-popup-handle" />
            <h3 id="tracking-detail-title" style={{ marginBottom: 12 }}>📄 รายละเอียดเอกสาร #{selectedDoc.running_no}</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              <div><strong>วันที่รับ:</strong> {selectedDoc.received_date}</div>
              <div><strong>เลขที่เอกสาร:</strong> {selectedDoc.doc_number || '-'}</div>
              <div><strong>เลขใบกำกับภาษี:</strong> {selectedDoc.tax_invoice_no || '-'}</div>
              <div><strong>ผู้ส่ง:</strong> {selectedDoc.sender}</div>
              <div><strong>เรื่อง:</strong> {selectedDoc.subject}</div>
              <div><strong>หน่วยงาน:</strong> {selectedDoc.recipient_dept_name}</div>
              <div><strong>สถานะ:</strong> <span className={`status-badge${STATUS_COLORS[selectedDoc.status] || ''}`}>{STATUS_LABELS[selectedDoc.status] || selectedDoc.status}</span></div>
              <div><strong>ผู้บันทึก:</strong> {selectedDoc.recorded_by_name || '-'}</div>
              {selectedDoc.admin_signature && <div><strong>ลายเซ็นส่งมอบ (Admin):</strong> {selectedDoc.admin_signature}</div>}
              {selectedDoc.admin_signed_at && <div><strong>ส่งมอบเมื่อ:</strong> {formatDate(selectedDoc.admin_signed_at)}</div>}
              {selectedDoc.inspector_signature && <div><strong>ผู้ตรวจสอบ:</strong> {selectedDoc.inspector_signature}</div>}
              {selectedDoc.purchasing_signature && <div><strong>จัดซื้อ:</strong> {selectedDoc.purchasing_signature}</div>}
              {selectedDoc.recipient_signature && <div><strong>ลายเซ็นผู้รับ:</strong> {selectedDoc.recipient_signature}</div>}
              {selectedDoc.status === 'rejected' && (
                <div className="toast error" style={{ position: 'static' }}>
                  <strong>เหตุผลที่แจ้งปัญหา:</strong> {selectedDoc.recipient_verification_note || 'ผู้รับไม่ได้ระบุเหตุผล'}
                </div>
              )}
              {selectedDoc.note && <div><strong>หมายเหตุ:</strong> {selectedDoc.note}</div>}
              {isAdmin && selectedDoc.status === 'rejected' && (
                <button className="ghost-button warning" style={{ marginTop: 8 }} onClick={() => handleRedeliver(selectedDoc)}>
                  📮 ส่งเซ็นใหม่
                </button>
              )}
              {isAdmin && selectedDoc.status === 'signed' && selectedDoc.delivery_log_id && (
                <button className="ghost-button success" style={{ marginTop: 8 }} onClick={() => handleCloseTask(selectedDoc)}>
                  🔒 ปิดงานเลย
                </button>
              )}
              {isSuperAdmin && (
                <button className="ghost-button danger" style={{ marginTop: 8 }} onClick={() => handleDeleteDoc(selectedDoc)}>
                  🗑 ลบเอกสารนี้
                </button>
              )}
            </div>
            <button className="scan-popup-close" onClick={() => setSelectedDoc(null)}>ปิด</button>
          </div>
        </div>
      )}
    </div>
  );
}
