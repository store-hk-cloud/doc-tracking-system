'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import type { Document } from '@/types';

export default function DeliveryPage() {
  const { user } = useAuth();
  const [docs, setDocs] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [signature, setSignature] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState('');

  const [signField, setSignField] = useState<{ doc: any; field: 'inspector_signature' | 'purchasing_signature'; label: string } | null>(null);
  const [signFieldValue, setSignFieldValue] = useState('');
  const [signFieldSubmitting, setSignFieldSubmitting] = useState(false);
  const [signFieldError, setSignFieldError] = useState('');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSignature, setBulkSignature] = useState('');
  const [bulkSigning, setBulkSigning] = useState(false);
  const [bulkMessage, setBulkMessage] = useState('');
  const [showBulkSignModal, setShowBulkSignModal] = useState(false);
  const [bulkSignError, setBulkSignError] = useState('');

  const [bulkField, setBulkField] = useState<{ field: 'inspector_signature' | 'purchasing_signature'; label: string } | null>(null);
  const [bulkFieldValue, setBulkFieldValue] = useState('');
  const [bulkFieldSubmitting, setBulkFieldSubmitting] = useState(false);
  const [bulkFieldError, setBulkFieldError] = useState('');

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

  const fetchDepartments = async () => {
    try {
      const res = await fetch('/api/departments');
      const data = await res.json();
      if (data.success) setDepartments(data.data);
    } catch (e) {
      console.error('fetch departments error:', e);
    }
  };

  useEffect(() => { fetchDocs(); fetchDepartments(); }, []);

  const handleSign = async () => {
    if (!signature.trim()) {
      setError('กรุณาพิมพ์ชื่อผู้ส่งมอบ');
      return;
    }
    setError('');

    const res = await fetch(`/api/documents/${selectedDoc.id}/sign`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_signature: signature }),
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

  const handleSignField = async () => {
    if (!signField || !signFieldValue.trim()) return;
    setSignFieldSubmitting(true);
    setSignFieldError('');
    const res = await fetch(`/api/documents/${signField.doc.id}/sign`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [signField.field]: signFieldValue }),
    });
    const data = await res.json();
    if (data.success) {
      setSignField(null);
      setSignFieldValue('');
      fetchDocs();
    } else {
      setSignFieldError(data.error || 'เกิดข้อผิดพลาด');
    }
    setSignFieldSubmitting(false);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((current) =>
      current.size === docs.length ? new Set() : new Set(docs.map((d: any) => d.id))
    );
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
    const ids = Array.from(selectedIds);
    const results = await Promise.all(
      ids.map((id) =>
        fetch(`/api/documents/${id}/sign`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ admin_signature: bulkSignature }),
        })
          .then((r) => r.json())
          .catch(() => ({ success: false }))
      )
    );
    const okCount = results.filter((r: any) => r.success).length;
    const failCount = results.length - okCount;
    setBulkMessage(
      failCount > 0
        ? `✅ ส่งมอบสำเร็จ ${okCount} รายการ, ❌ ล้มเหลว ${failCount} รายการ`
        : `✅ ส่งมอบสำเร็จ ${okCount} รายการ`
    );
    setSelectedIds(new Set());
    setBulkSignature('');
    setBulkSigning(false);
    setShowBulkSignModal(false);
    fetchDocs();
  };

  const eligibleForBulkField = docs.filter((d: any) => selectedIds.has(d.id) && d.subject === 'ใบรับสินค้า');

  const handleBulkField = async () => {
    if (!bulkField || eligibleForBulkField.length === 0 || !bulkFieldValue.trim()) return;
    if (!window.confirm(`ยืนยันเซ็น${bulkField.label} ${eligibleForBulkField.length} รายการ?`)) return;
    setBulkFieldSubmitting(true);
    setBulkFieldError('');
    const results = await Promise.all(
      eligibleForBulkField.map((doc: any) =>
        fetch(`/api/documents/${doc.id}/sign`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [bulkField.field]: bulkFieldValue }),
        })
          .then((r) => r.json())
          .catch(() => ({ success: false }))
      )
    );
    const okCount = results.filter((r: any) => r.success).length;
    const failCount = results.length - okCount;
    setBulkMessage(
      failCount > 0
        ? `✅ เซ็น${bulkField.label}สำเร็จ ${okCount} รายการ, ❌ ล้มเหลว ${failCount} รายการ`
        : `✅ เซ็น${bulkField.label}สำเร็จ ${okCount} รายการ`
    );
    setBulkField(null);
    setBulkFieldValue('');
    setBulkFieldSubmitting(false);
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
        <div className="packer-header">
          <span className="eyebrow">📋 รายการรอส่งมอบ ({docs.length} รายการ)</span>
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
            <button
              className="ghost-button"
              style={{ width: 'auto', padding: '0 14px' }}
              onClick={() => { setShowBulkSignModal(true); setBulkSignature(''); setBulkSignError(''); }}
            >
              ✅ ส่งมอบทั้งหมด ({selectedIds.size})
            </button>
            {eligibleForBulkField.length > 0 && (
              <>
                <button
                  className="ghost-button"
                  style={{ width: 'auto', padding: '0 14px' }}
                  onClick={() => { setBulkField({ field: 'inspector_signature', label: 'ผู้ตรวจสอบ' }); setBulkFieldValue(''); setBulkFieldError(''); }}
                >
                  ✍️ เซ็นผู้ตรวจสอบทั้งหมด ({eligibleForBulkField.length})
                </button>
                <button
                  className="ghost-button"
                  style={{ width: 'auto', padding: '0 14px' }}
                  onClick={() => { setBulkField({ field: 'purchasing_signature', label: 'จัดซื้อ' }); setBulkFieldValue(''); setBulkFieldError(''); }}
                >
                  ✍️ เซ็นจัดซื้อทั้งหมด ({eligibleForBulkField.length})
                </button>
              </>
            )}
          </div>
        )}

        {bulkMessage && <div className="toast success" style={{ position: 'static', marginBottom: 12 }}>{bulkMessage}</div>}

        {loading ? (
          <div className="empty-search">กำลังโหลด...</div>
        ) : docs.length === 0 ? (
          <div className="empty-search">ไม่มีเอกสารรอส่งมอบ</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={selectedIds.size === docs.length && docs.length > 0}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th>No.</th>
                  <th>วันที่รับ</th>
                  <th>ผู้ส่ง</th>
                  <th>เลขที่เอกสาร</th>
                  <th>เรื่อง</th>
                  <th>หน่วยงาน</th>
                  <th>ดำเนินการ</th>
                  <th>ผู้ตรวจสอบ</th>
                  <th>จัดซื้อ</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((doc: any) => (
                  <tr key={doc.id}>
                    <td>
                      <input type="checkbox" checked={selectedIds.has(doc.id)} onChange={() => toggleSelect(doc.id)} />
                    </td>
                    <td className="code-cell">{doc.running_no}</td>
                    <td>{doc.received_date}</td>
                    <td>{doc.sender}</td>
                    <td>{doc.doc_number || '-'}</td>
                    <td>{doc.subject}</td>
                    <td>{doc.recipient_dept_name}</td>
                    <td>
                      <button
                        className="table-action-button"
                        onClick={() => {
                          setSelectedDoc(doc);
                          setShowModal(true);
                          setSignature('');
                          setError('');
                        }}
                      >
                        ✍️ ส่งมอบ
                      </button>
                    </td>
                    {doc.subject === 'ใบรับสินค้า' ? (
                      <>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span>{doc.inspector_signature || '-'}</span>
                            <button
                              className="ghost-button"
                              style={{ width: 'auto', padding: '0 10px', minHeight: 28, fontSize: '0.78rem' }}
                              onClick={() => {
                                setSignField({ doc, field: 'inspector_signature', label: 'ผู้ตรวจสอบ' });
                                setSignFieldValue(doc.inspector_signature || '');
                                setSignFieldError('');
                              }}
                            >
                              {doc.inspector_signature ? '✏️ แก้ไข' : '✍️ เซ็น'}
                            </button>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span>{doc.purchasing_signature || '-'}</span>
                            <button
                              className="ghost-button"
                              style={{ width: 'auto', padding: '0 10px', minHeight: 28, fontSize: '0.78rem' }}
                              onClick={() => {
                                setSignField({ doc, field: 'purchasing_signature', label: 'จัดซื้อ' });
                                setSignFieldValue(doc.purchasing_signature || '');
                                setSignFieldError('');
                              }}
                            >
                              {doc.purchasing_signature ? '✏️ แก้ไข' : '✍️ เซ็น'}
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>-</td>
                        <td>-</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && selectedDoc && (
        <div className="scan-popup-overlay" onClick={() => setShowModal(false)}>
          <div className="scan-popup-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500, margin: '0 auto' }}>
            <div className="scan-popup-handle" />
            <h3 style={{ marginBottom: 12 }}>✍️ ส่งมอบเอกสาร #{selectedDoc.running_no}</h3>

            <div style={{ display: 'grid', gap: 8, marginBottom: 16, fontSize: '0.9rem' }}>
              <div><strong>ผู้ส่ง:</strong> {selectedDoc.sender}</div>
              <div><strong>เรื่อง:</strong> {selectedDoc.subject}</div>
              <div><strong>เลขที่เอกสาร:</strong> {selectedDoc.doc_number || '-'}</div>
              <div><strong>เลขใบกำกับภาษี:</strong> {selectedDoc.tax_invoice_no || '-'}</div>
              <div><strong>หน่วยงาน:</strong> {selectedDoc.recipient_dept_name}</div>
              <div><strong>วันที่รับ:</strong> {selectedDoc.received_date}</div>
            </div>

            <div className="form-group">
              <label>ลายเซ็นผู้ส่งมอบ (พิมพ์ชื่อ) *</label>
              <input
                type="text"
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder="พิมพ์ชื่อผู้ส่งมอบ"
                style={{ fontFamily: 'Caveat, cursive', fontSize: '1.3rem' }}
              />
            </div>

            {error && <div className="toast error" style={{ position: 'static', marginBottom: 8 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button className="ghost-button" onClick={() => setShowModal(false)} style={{ flex: 1 }}>
                ยกเลิก
              </button>
              <button className="secondary-button" onClick={handleSign} style={{ flex: 1 }}>
                ✅ ยืนยันส่งมอบ
              </button>
            </div>

            <button className="scan-popup-close" onClick={() => setShowModal(false)}>ปิด</button>
          </div>
        </div>
      )}

      {/* Bulk deliver sign popup */}
      {showBulkSignModal && (
        <div className="scan-popup-overlay" onClick={() => setShowBulkSignModal(false)}>
          <div className="scan-popup-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, margin: '0 auto' }}>
            <div className="scan-popup-handle" />
            <h3 style={{ marginBottom: 12 }}>✍️ ส่งมอบทั้งหมด ({selectedIds.size} รายการ)</h3>

            <div className="form-group">
              <label>ลายเซ็นผู้ส่งมอบ (ใช้กับทุกรายการที่เลือก) *</label>
              <input
                type="text"
                value={bulkSignature}
                onChange={(e) => setBulkSignature(e.target.value)}
                placeholder="พิมพ์ชื่อผู้ส่งมอบ"
                style={{ fontFamily: 'Caveat, cursive', fontSize: '1.3rem' }}
              />
            </div>

            {bulkSignError && <div className="toast error" style={{ position: 'static', marginBottom: 8 }}>{bulkSignError}</div>}

            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button className="ghost-button" onClick={() => setShowBulkSignModal(false)} style={{ flex: 1 }}>
                ยกเลิก
              </button>
              <button className="secondary-button" onClick={handleBulkSign} disabled={bulkSigning} style={{ flex: 1 }}>
                {bulkSigning ? 'กำลังส่งมอบ...' : '✅ ยืนยัน'}
              </button>
            </div>

            <button className="scan-popup-close" onClick={() => setShowBulkSignModal(false)}>ปิด</button>
          </div>
        </div>
      )}

      {/* Inspector / purchasing single-field sign popup */}
      {signField && (
        <div className="scan-popup-overlay" onClick={() => setSignField(null)}>
          <div className="scan-popup-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, margin: '0 auto' }}>
            <div className="scan-popup-handle" />
            <h3 style={{ marginBottom: 12 }}>✍️ เซ็นรับ — {signField.label} #{signField.doc.running_no}</h3>

            <div style={{ display: 'grid', gap: 8, marginBottom: 16, fontSize: '0.9rem' }}>
              <div><strong>ผู้ส่ง:</strong> {signField.doc.sender}</div>
              <div><strong>เรื่อง:</strong> {signField.doc.subject}</div>
              <div><strong>เลขที่เอกสาร:</strong> {signField.doc.doc_number || '-'}</div>
              <div><strong>เลขใบกำกับภาษี:</strong> {signField.doc.tax_invoice_no || '-'}</div>
              <div><strong>หน่วยงาน:</strong> {signField.doc.recipient_dept_name}</div>
              <div><strong>วันที่รับ:</strong> {signField.doc.received_date}</div>
            </div>

            <div className="form-group">
              <label>ชื่อ{signField.label} *</label>
              <input
                type="text"
                value={signFieldValue}
                onChange={(e) => setSignFieldValue(e.target.value)}
                placeholder={`พิมพ์ชื่อ${signField.label}`}
                style={{ fontFamily: 'Caveat, cursive', fontSize: '1.3rem' }}
              />
            </div>

            {signFieldError && <div className="toast error" style={{ position: 'static', marginBottom: 8 }}>{signFieldError}</div>}

            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button className="ghost-button" onClick={() => setSignField(null)} style={{ flex: 1 }}>
                ยกเลิก
              </button>
              <button className="secondary-button" onClick={handleSignField} disabled={signFieldSubmitting} style={{ flex: 1 }}>
                {signFieldSubmitting ? 'กำลังบันทึก...' : '✅ ยืนยัน'}
              </button>
            </div>

            <button className="scan-popup-close" onClick={() => setSignField(null)}>ปิด</button>
          </div>
        </div>
      )}

      {/* Bulk inspector / purchasing sign popup */}
      {bulkField && (
        <div className="scan-popup-overlay" onClick={() => setBulkField(null)}>
          <div className="scan-popup-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, margin: '0 auto' }}>
            <div className="scan-popup-handle" />
            <h3 style={{ marginBottom: 12 }}>✍️ เซ็นรับ — {bulkField.label} ({eligibleForBulkField.length} รายการ)</h3>

            <div className="form-group">
              <label>ชื่อ{bulkField.label} (ใช้กับทุกรายการที่เลือก) *</label>
              <input
                type="text"
                value={bulkFieldValue}
                onChange={(e) => setBulkFieldValue(e.target.value)}
                placeholder={`พิมพ์ชื่อ${bulkField.label}`}
                style={{ fontFamily: 'Caveat, cursive', fontSize: '1.3rem' }}
              />
            </div>

            {bulkFieldError && <div className="toast error" style={{ position: 'static', marginBottom: 8 }}>{bulkFieldError}</div>}

            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button className="ghost-button" onClick={() => setBulkField(null)} style={{ flex: 1 }}>
                ยกเลิก
              </button>
              <button className="secondary-button" onClick={handleBulkField} disabled={bulkFieldSubmitting} style={{ flex: 1 }}>
                {bulkFieldSubmitting ? 'กำลังบันทึก...' : '✅ ยืนยัน'}
              </button>
            </div>

            <button className="scan-popup-close" onClick={() => setBulkField(null)}>ปิด</button>
          </div>
        </div>
      )}
    </div>
  );
}
