'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { createClient } from '@/lib/supabase/client';
import type { Document } from '@/types';

export default function DeliveryPage() {
  const { user } = useAuth();
  const supabase = createClient();
  const [docs, setDocs] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [signature, setSignature] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState('');

  const fetchDocs = async () => {
    const { data } = await supabase
      .from('documents')
      .select('*, departments(name)')
      .eq('status', 'registered')
      .order('running_no');
    if (data) setDocs(data);
    setLoading(false);
  };

  const fetchDepartments = async () => {
    const { data } = await supabase.from('departments').select('*').order('name');
    if (data) setDepartments(data);
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

        {loading ? (
          <div className="empty-search">กำลังโหลด...</div>
        ) : docs.length === 0 ? (
          <div className="empty-search">ไม่มีเอกสารรอส่งมอบ</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>No.</th>
                  <th>วันที่รับ</th>
                  <th>ผู้ส่ง</th>
                  <th>เรื่อง</th>
                  <th>หน่วยงาน</th>
                  <th>ดำเนินการ</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((doc: any) => (
                  <tr key={doc.id}>
                    <td className="code-cell">{doc.running_no}</td>
                    <td>{doc.received_date}</td>
                    <td>{doc.sender}</td>
                    <td>{doc.subject}</td>
                    <td>{doc.departments?.name}</td>
                    <td>
                      <button
                        className="table-action-button"
                        onClick={() => { setSelectedDoc(doc); setShowModal(true); setSignature(''); setError(''); }}
                      >
                        ✍️ ส่งมอบ
                      </button>
                    </td>
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
              <div><strong>หน่วยงาน:</strong> {selectedDoc.departments?.name}</div>
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
    </div>
  );
}