'use client';

import { useEffect, useState } from 'react';
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
// ใบรับสินค้าข้าม delivered ไป awaiting_* ทันทีที่ส่งมอบ ปุ่ม "ส่งมอบแล้ว" จึงต้อง
// หมายถึง "ส่งออกไปแล้วแต่ยังไม่จบ" ทุกด่าน ไม่งั้นใบรับสินค้าจะไม่ถูกจับด้วยปุ่มไหนเลย
// ส่วนปุ่มรายด่านยังกดดูเจาะจงได้เหมือนเดิม
const STATUS_QUERY: Record<string, string[]> = {
  delivered: ['delivered', 'awaiting_inspector', 'awaiting_purchasing', 'awaiting_recipient'],
};
// ปุ่มกรองกินความกว้างกว่า badge ในตาราง จึงต้องมีป้ายของตัวเอง
const FILTER_LABELS: Record<string, string> = { ...STATUS_LABELS, delivered: 'ส่งมอบแล้ว (ทุกด่าน)' };
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

export default function TrackingPage() {
  const { profile, user } = useAuth();
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: '', keyword: '', dept_id: '' });
  const [onlyMine, setOnlyMine] = useState(false);
  const [departments, setDepartments] = useState<any[]>([]);
  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'admin';
  const isSuperAdmin = profile?.role === 'super_admin';
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [signedCount, setSignedCount] = useState<number | null>(null);
  const [closingAll, setClosingAll] = useState(false);
  const [closeAllMessage, setCloseAllMessage] = useState('');

  useEffect(() => {
    window.fetch('/api/departments').then(r => r.json()).then(data => {
      if (data.success) setDepartments(data.data);
    });
  }, []);

  const loadSignedCount = async () => {
    if (!isAdmin) return;
    const res = await window.fetch('/api/documents?status=signed');
    const data = await res.json();
    if (data.success) setSignedCount(data.data.filter((d: any) => d.delivery_log_id).length);
  };

  useEffect(() => { loadSignedCount(); }, [isAdmin]);

  const loadDocs = async () => {
    setLoading(true);
    let url = '/api/documents?';
    if (filter.status) {
      for (const s of STATUS_QUERY[filter.status] || [filter.status]) url += `status=${s}&`;
    }
    if (filter.keyword) url += `keyword=${encodeURIComponent(filter.keyword)}&`;
    if (filter.dept_id) url += `dept_id=${filter.dept_id}&`;
    // ปล่อยให้ API กรองตามขั้น workflow เพื่อให้คลังสินค้า/FAC-PP และจัดซื้อ
    // เห็นเฉพาะใบรับสินค้าที่ถึงคิว แม้ recipient task อยู่ที่บัญชี.

    const res = await window.fetch(url);
    const data = await res.json();
    if (data.success) setDocs(data.data);
    setLoading(false);
  };

  useEffect(() => { loadDocs(); }, [filter.status]);

  const handleDeleteDoc = async (doc: any) => {
    if (!window.confirm(`⚠️ ลบเอกสาร #${doc.running_no} "${doc.subject}"?`)) return;
    const res = await window.fetch(`/api/documents/${doc.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      setDocs(docs.filter((d: any) => d.id !== doc.id));
    }
  };

  const handleCloseTask = async (doc: any) => {
    if (!doc.delivery_log_id) return;
    if (!window.confirm(`ปิดงานเอกสาร #${doc.running_no} "${doc.subject}"?`)) return;
    const res = await window.fetch(`/api/deliveries/${doc.delivery_log_id}/verify`, { method: 'PUT' });
    const data = await res.json();
    if (data.success) {
      setDocs(docs.map((d: any) => (d.id === doc.id ? { ...d, status: 'closed' } : d)));
      setSelectedDoc((current: any) => (current && current.id === doc.id ? { ...current, status: 'closed' } : current));
    } else {
      window.alert(data.error || 'เกิดข้อผิดพลาด');
    }
  };

  const handleCloseAllSigned = async () => {
    setCloseAllMessage('');
    const res = await window.fetch('/api/documents?status=signed');
    const data = await res.json();
    if (!data.success) return;
    const targets = data.data.filter((d: any) => d.delivery_log_id);
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
    const res = await window.fetch(`/api/documents/${doc.id}/redeliver`, { method: 'PUT' });
    const data = await res.json();
    if (data.success) {
      setDocs(docs.map((d: any) => (d.id === doc.id ? { ...d, status: data.data.status } : d)));
      setSelectedDoc(null);
    } else {
      window.alert(data.error || 'เกิดข้อผิดพลาด');
    }
  };

  // recorded_by ติดมากับทุกแถวของ /api/documents อยู่แล้ว จึงสลับมุมมองได้ฝั่ง
  // client ไม่ต้องยิง API ซ้ำ
  const visibleDocs = onlyMine ? docs.filter((d: any) => d.recorded_by === user?.id) : docs;

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
                {FILTER_LABELS[s]}
              </button>
            ))}
          </div>
          <div className="segmented-control search-status-row">
            <button className={onlyMine ? '' : 'active'} onClick={() => setOnlyMine(false)}>ทั้งหมด</button>
            <button className={onlyMine ? 'active' : ''} onClick={() => setOnlyMine(true)}>ที่ฉันส่งมอบ</button>
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
          {closeAllMessage && <div className="toast success" style={{ position: 'static', marginTop: 12 }}>{closeAllMessage}</div>}
        </div>
      </div>

      {/* Results */}
      <div className="report-panel">
        {loading ? (
          <div className="empty-search">กำลังโหลด...</div>
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
                    <th>ลายเซ็น Admin</th>
                    <th>ผู้ตรวจสอบ</th>
                    <th>จัดซื้อ</th>
                    <th>ลายเซ็นผู้รับ</th>
                    {isSuperAdmin && <th>ลบ</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleDocs.map((doc: any) => (
                    <tr key={doc.id} onClick={() => setSelectedDoc(doc)} style={{ cursor: 'pointer' }}>
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
                      <td>{doc.admin_signature || '-'}</td>
                      <td>{doc.inspector_signature || '-'}</td>
                      <td>{doc.purchasing_signature || '-'}</td>
                      <td>{doc.recipient_signature || '-'}</td>
                      {isSuperAdmin && (
                        <td>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteDoc(doc); }}
                            style={{ background: 'var(--danger)', color: 'white', border: 'none', padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: '0.8rem' }}
                          >
                            🗑
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: '0.85rem', fontWeight: 700 }}>
              พบทั้งหมด {visibleDocs.length} รายการ
            </div>
          </>
        )}
      </div>

      {/* Modal */}
      {selectedDoc && (
        <div className="scan-popup-overlay" onClick={() => setSelectedDoc(null)}>
          <div className="scan-popup-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520, margin: '0 auto' }}>
            <div className="scan-popup-handle" />
            <h3 style={{ marginBottom: 12 }}>📄 รายละเอียดเอกสาร #{selectedDoc.running_no}</h3>
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
              {selectedDoc.inspector_signature && <div><strong>ผู้ตรวจสอบ:</strong> {selectedDoc.inspector_signature}</div>}
              {selectedDoc.purchasing_signature && <div><strong>จัดซื้อ:</strong> {selectedDoc.purchasing_signature}</div>}
              {selectedDoc.recipient_signature && <div><strong>ลายเซ็นผู้รับ:</strong> {selectedDoc.recipient_signature}</div>}
              {selectedDoc.note && <div><strong>หมายเหตุ:</strong> {selectedDoc.note}</div>}
              {isAdmin && selectedDoc.status === 'rejected' && (
                <button
                  onClick={() => handleRedeliver(selectedDoc)}
                  style={{ marginTop: 8, background: 'var(--warning)', color: 'white', border: 'none', padding: '10px', borderRadius: 8, cursor: 'pointer' }}
                >
                  📮 ส่งเซ็นใหม่
                </button>
              )}
              {isAdmin && selectedDoc.status === 'signed' && selectedDoc.delivery_log_id && (
                <button
                  onClick={() => handleCloseTask(selectedDoc)}
                  style={{ marginTop: 8, background: 'var(--success)', color: 'white', border: 'none', padding: '10px', borderRadius: 8, cursor: 'pointer' }}
                >
                  🔒 ปิดงานเลย
                </button>
              )}
              {isSuperAdmin && (
                <button
                  onClick={() => handleDeleteDoc(selectedDoc)}
                  style={{ marginTop: 8, background: 'var(--danger)', color: 'white', border: 'none', padding: '10px', borderRadius: 8, cursor: 'pointer' }}
                >
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
