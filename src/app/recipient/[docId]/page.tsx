'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useParams } from 'next/navigation';

export default function RecipientPage() {
  const { user, profile } = useAuth();
  const params = useParams();
  const docId = params.docId as string;
  const [doc, setDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [signature, setSignature] = useState('');
  const [verified, setVerified] = useState(true);
  const [verifyNote, setVerifyNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [existingDelivery, setExistingDelivery] = useState<any>(null);

  useEffect(() => {
    const fetchDoc = async () => {
      try {
        const res = await fetch(`/api/documents/${docId}`);
        const data = await res.json();
        if (data.success) {
          setDoc(data.data);
          // Check if already signed via delivery logs
          const deliveryRes = await fetch('/api/deliveries?document_id=' + docId);
          const deliveryData = await deliveryRes.json();
          if (deliveryData.success && deliveryData.data.length > 0) {
            setExistingDelivery(deliveryData.data[0]);
          }
        }
      } catch (e) {
        console.error('fetch doc error:', e);
      }
      setLoading(false);
    };
    if (docId) fetchDoc();
  }, [docId]);

  const handleSubmit = async () => {
    if (!signature.trim()) {
      setError('กรุณาพิมพ์ชื่อผู้รับ');
      return;
    }
    setSubmitting(true);
    setError('');

    const res = await fetch('/api/deliveries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document_id: docId,
        recipient_id: user?.id,
        recipient_signature: signature,
        recipient_name: profile?.full_name,
        is_verified: verified,
        verification_note: verified ? null : verifyNote,
      }),
    });

    const data = await res.json();
    if (data.success) {
      setSuccess(verified ? '✅ รับเอกสารเรียบร้อย' : '⚠️ แจ้งปัญหาเรียบร้อย');
    } else {
      setError(data.error || 'เกิดข้อผิดพลาด');
    }
    setSubmitting(false);
  };

  if (loading) return <div className="loading-screen">กำลังโหลด...</div>;
  if (!doc) return <div className="loading-screen">ไม่พบเอกสาร</div>;
  if (existingDelivery) {
    return (
      <div className="scan-panel" style={{ maxWidth: 580, margin: '40px auto' }}>
        <div className="app-title" style={{ textAlign: 'center' }}>
          <div className="title-badge">✅ ดำเนินการแล้ว</div>
          <h3>เอกสารนี้ได้รับการดำเนินการแล้ว</h3>
        </div>
        <div style={{ marginTop: 16, textAlign: 'center', color: 'var(--muted)' }}>
          ลงชื่อรับเมื่อ: {new Date(existingDelivery.recipient_signed_at).toLocaleString('th-TH')}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 580, margin: '0 auto' }}>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="title-badge">✍️ รับเอกสาร</div>
        <h3>ตรวจสอบและรับเอกสาร</h3>
        <div className="title-accent" />
      </div>

      <div className="scan-panel">
        <div style={{ display: 'grid', gap: 10, marginBottom: 20 }}>
          <div className="field-control">
            <span>Running No.</span>
            <div style={{ fontWeight: 800, fontSize: '1.2rem' }}>#{doc.running_no}</div>
          </div>
          <div className="form-row">
            <div className="field-control">
              <span>วันที่รับ</span>
              <div style={{ fontWeight: 700 }}>{doc.received_date}</div>
            </div>
            <div className="field-control">
              <span>ผู้ส่ง</span>
              <div style={{ fontWeight: 700 }}>{doc.sender}</div>
            </div>
          </div>
          <div className="field-control">
            <span>เรื่อง</span>
            <div style={{ fontWeight: 700 }}>{doc.subject}</div>
          </div>
          <div className="field-control">
            <span>หน่วยงานผู้รับ</span>
            <div style={{ fontWeight: 700 }}>{doc.recipient_dept_name}</div>
          </div>
          {doc.doc_number && (
            <div className="field-control">
              <span>เลขที่เอกสาร</span>
              <div style={{ fontWeight: 700 }}>{doc.doc_number}</div>
            </div>
          )}
          {doc.note && (
            <div className="field-control">
              <span>หมายเหตุ</span>
              <div style={{ fontWeight: 700, color: 'var(--warning)' }}>{doc.note}</div>
            </div>
          )}
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '16px 0' }} />

        <div className="form-group">
          <label>✅ ตรวจสอบความถูกต้อง</label>
          <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
            <button
              className={verified ? 'secondary-button' : 'ghost-button'}
              onClick={() => { setVerified(true); setVerifyNote(''); }}
              style={{ flex: 1, minHeight: 44 }}
            >
              ✅ ถูกต้อง
            </button>
            <button
              className={!verified ? 'secondary-button' : 'ghost-button'}
              onClick={() => setVerified(false)}
              style={{ flex: 1, minHeight: 44, background: !verified ? 'var(--danger)' : undefined, borderColor: 'var(--danger)' }}
            >
              ❌ ไม่ถูกต้อง
            </button>
          </div>
        </div>

        {!verified && (
          <div className="issue-bar" style={{ marginTop: 12 }}>
            <div className="form-group">
              <label>สาเหตุ</label>
              <select value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)}>
                <option value="">-- เลือกสาเหตุ --</option>
                <option value="จำนวนไม่ตรง">จำนวนไม่ตรง</option>
                <option value="เอกสารผิด">เอกสารผิด</option>
                <option value="ไม่ครบถ้วน">ไม่ครบถ้วน</option>
                <option value="อื่นๆ">อื่นๆ</option>
              </select>
            </div>
            <div className="form-group">
              <label>หมายเหตุเพิ่มเติม</label>
              <textarea value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} placeholder="ระบุรายละเอียด..." />
            </div>
          </div>
        )}

        <div className="form-group" style={{ marginTop: 16 }}>
          <label>✍️ ลายเซ็นผู้รับ (พิมพ์ชื่อ) *</label>
          <input
            type="text"
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder="พิมพ์ชื่อผู้รับ"
            style={{ fontFamily: 'Caveat, cursive', fontSize: '1.4rem', minHeight: 48 }}
          />
        </div>

        {success && <div className="toast success" style={{ position: 'static', marginBottom: 8 }}>{success}</div>}
        {error && <div className="toast error" style={{ position: 'static', marginBottom: 8 }}>{error}</div>}

        {!success && (
          <button
            className="secondary-button"
            onClick={handleSubmit}
            disabled={submitting}
            style={{ marginTop: 12 }}
          >
            {submitting ? 'กำลังดำเนินการ...' : verified ? '✅ ยืนยันรับเอกสาร' : '⚠️ แจ้งปัญหา'}
          </button>
        )}
      </div>
    </div>
  );
}