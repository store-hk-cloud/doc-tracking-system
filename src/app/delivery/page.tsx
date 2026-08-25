'use client';

import { useEffect, useState } from 'react';
import { documentNo } from '@/lib/document-no';

export default function DeliveryPage() {
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [signature, setSignature] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSignature, setBulkSignature] = useState('');
  const [bulkSigning, setBulkSigning] = useState(false);
  const [bulkMessage, setBulkMessage] = useState('');
  const [showBulkSignModal, setShowBulkSignModal] = useState(false);
  const [bulkSignError, setBulkSignError] = useState('');

  const fetchDocs = async () => {
    try {
      const res = await fetch('/api/documents?status=registered&scope=mine');
      const data = await res.json();
      if (data.success) setDocs(data.data);
    } catch (e) {
      console.error('fetch docs error:', e);
    }
    setLoading(false);
  };

  useEffect(() => { fetchDocs(); }, []);

  const handleSign = async () => {
    if (!signature.trim()) {
      setError('กรุณาพิมพ์ชื่อผู้ส่งมอบ');
      return;
    }
    setError('');
    const res = await fetch(`/api/documents/${selectedDoc.id}/sign`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_signature: signature.trim() }),
    });
    const data = await res.json();
    if (data.success) {
      setShowModal(false);
      setSignature('');
      setSelectedDoc(null);
      fetchDocs();
    } else {
      setError(data.error || 'เกิดข้อผิดพลาด');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((current) => current.size === docs.length ? new Set() : new Set(docs.map((d: any) => d.id)));
  };

  const handleBulkSign = async () => {
    if (selectedIds.size === 0) return;
    if (!bulkSignature.trim()) {
      setBulkSignError('กรุณาพิมพ์ชื่อผู้ส่งมอบก่อน');
      return;
    }
    if (!window.confirm(`ยืนยันส่งมอบเอกสาร ${selectedIds.size} รายการ?`)) return;
    setBulkSigning(true);
    setBulkSignError('');
    setBulkMessage('');
    const results = await Promise.all(Array.from(selectedIds).map((id) =>
      fetch(`/api/documents/${id}/sign`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_signature: bulkSignature.trim() }),
      }).then((r) => r.json()).catch(() => ({ success: false }))
    ));
    const okCount = results.filter((r: any) => r.success).length;
    const failCount = results.length - okCount;
    setBulkMessage(failCount > 0
      ? `✅ ส่งมอบสำเร็จ ${okCount} รายการ, ❌ ล้มเหลว ${failCount} รายการ`
      : `✅ ส่งมอบสำเร็จ ${okCount} รายการ`);
    setSelectedIds(new Set());
    setBulkSignature('');
    setBulkSigning(false);
    setShowBulkSignModal(false);
    fetchDocs();
  };

  return (
    <div>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="title-badge">📦 ส่งมอบ</div>
        <h2>ส่งมอบเอกสารให้หน่วยงาน</h2>
        <div className="title-accent" />
      </div>

      <div className="scan-panel">
        <div className="packer-header"><span className="eyebrow">📋 รายการรอส่งมอบ ({docs.length} รายการ)</span></div>
        {selectedIds.size > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: '10px 14px', background: 'var(--primary-soft)', borderRadius: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700 }}>เลือกแล้ว {selectedIds.size} รายการ</span>
            <button className="ghost-button" style={{ width: 'auto', padding: '0 14px' }} onClick={() => { setShowBulkSignModal(true); setBulkSignature(''); setBulkSignError(''); }}>
              ✅ ส่งมอบทั้งหมด ({selectedIds.size})
            </button>
          </div>
        )}
        {bulkMessage && <div className="toast success" style={{ position: 'static', marginBottom: 12 }}>{bulkMessage}</div>}

        {loading ? <div className="empty-search">กำลังโหลด...</div> : docs.length === 0 ? <div className="empty-search">ไม่มีเอกสารรอส่งมอบ</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th><input type="checkbox" checked={selectedIds.size === docs.length && docs.length > 0} onChange={toggleSelectAll} /></th>
                <th>No.</th><th>วันที่รับ</th><th>ผู้ส่ง</th><th>เลขที่เอกสาร</th><th>เรื่อง</th><th>หน่วยงาน</th><th>ดำเนินการ</th>
              </tr></thead>
              <tbody>{docs.map((doc: any) => (
                <tr key={doc.id}>
                  <td><input type="checkbox" checked={selectedIds.has(doc.id)} onChange={() => toggleSelect(doc.id)} /></td>
                  <td className="code-cell">{documentNo(doc)}</td><td>{doc.received_date}</td><td>{doc.sender}</td><td>{doc.doc_number || '-'}</td><td>{doc.subject}</td><td>{doc.recipient_dept_name}</td>
                  <td><button className="table-action-button" onClick={() => { setSelectedDoc(doc); setShowModal(true); setSignature(''); setError(''); }}>✍️ ส่งมอบ</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && selectedDoc && (
        <div className="scan-popup-overlay" onClick={() => setShowModal(false)}>
          <div className="scan-popup-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500, margin: '0 auto' }}>
            <div className="scan-popup-handle" />
            <h3 style={{ marginBottom: 12 }}>✍️ ส่งมอบเอกสาร {documentNo(selectedDoc)}</h3>
            <div style={{ display: 'grid', gap: 8, marginBottom: 16, fontSize: '0.9rem' }}>
              <div><strong>ผู้ส่ง:</strong> {selectedDoc.sender}</div><div><strong>เรื่อง:</strong> {selectedDoc.subject}</div><div><strong>เลขที่เอกสาร:</strong> {selectedDoc.doc_number || '-'}</div><div><strong>เลขใบกำกับภาษี:</strong> {selectedDoc.tax_invoice_no || '-'}</div><div><strong>หน่วยงาน:</strong> {selectedDoc.recipient_dept_name}</div><div><strong>วันที่รับ:</strong> {selectedDoc.received_date}</div>
            </div>
            <div className="form-group"><label>ลายเซ็นผู้ส่งมอบ (พิมพ์ชื่อ) *</label><input type="text" value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="พิมพ์ชื่อผู้ส่งมอบ" style={{ fontFamily: 'Caveat, cursive', fontSize: '1.3rem' }} /></div>
            {error && <div className="toast error" style={{ position: 'static', marginBottom: 8 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}><button className="ghost-button" onClick={() => setShowModal(false)} style={{ flex: 1 }}>ยกเลิก</button><button className="secondary-button" onClick={handleSign} style={{ flex: 1 }}>✅ ยืนยันส่งมอบ</button></div>
            <button className="scan-popup-close" onClick={() => setShowModal(false)}>ปิด</button>
          </div>
        </div>
      )}

      {showBulkSignModal && (
        <div className="scan-popup-overlay" onClick={() => setShowBulkSignModal(false)}>
          <div className="scan-popup-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, margin: '0 auto' }}>
            <div className="scan-popup-handle" /><h3 style={{ marginBottom: 12 }}>✍️ ส่งมอบทั้งหมด ({selectedIds.size} รายการ)</h3>
            <div className="form-group"><label>ลายเซ็นผู้ส่งมอบ (ใช้กับทุกรายการที่เลือก) *</label><input type="text" value={bulkSignature} onChange={(e) => setBulkSignature(e.target.value)} placeholder="พิมพ์ชื่อผู้ส่งมอบ" style={{ fontFamily: 'Caveat, cursive', fontSize: '1.3rem' }} /></div>
            {bulkSignError && <div className="toast error" style={{ position: 'static', marginBottom: 8 }}>{bulkSignError}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}><button className="ghost-button" onClick={() => setShowBulkSignModal(false)} style={{ flex: 1 }}>ยกเลิก</button><button className="secondary-button" onClick={handleBulkSign} disabled={bulkSigning} style={{ flex: 1 }}>{bulkSigning ? 'กำลังส่งมอบ...' : '✅ ยืนยัน'}</button></div>
            <button className="scan-popup-close" onClick={() => setShowBulkSignModal(false)}>ปิด</button>
          </div>
        </div>
      )}
    </div>
  );
}
