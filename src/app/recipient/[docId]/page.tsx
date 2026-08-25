'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useParams } from 'next/navigation';
import { getGoodsReceiptWorkflowAction, isGoodsReceipt } from '@/lib/document-workflow';
import { documentNo } from '@/lib/document-no';

export default function RecipientPage() {
  const { profile } = useAuth();
  const params = useParams();
  const docId = params.docId as string;
  const [doc, setDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(true);
  const [verifyNote, setVerifyNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [editingApprovalStage, setEditingApprovalStage] = useState<'inspector_signature' | 'purchasing_signature' | null>(null);
  const [existingDelivery, setExistingDelivery] = useState<any>(null);
  // ลายเซ็นผู้รับ: เติมชื่อบัญชีให้เป็นค่าเริ่มต้น แต่แก้เป็นชื่อผู้รับตัวจริงได้
  const [signature, setSignature] = useState('');
  const [signatureTouched, setSignatureTouched] = useState(false);

  const isGoodsReceiptDocument = isGoodsReceipt(doc?.subject);
  const workflowAction = isGoodsReceiptDocument
    ? getGoodsReceiptWorkflowAction(profile?.department_code, doc?.status)
    : null;
  const pendingApprovalStage = workflowAction === 'inspector' ? 'inspector_signature'
    : workflowAction === 'purchasing' ? 'purchasing_signature'
      : null;
  const approvalStage = editingApprovalStage || pendingApprovalStage;
  const approvalLabel = approvalStage === 'inspector_signature' ? 'ผู้ตรวจสอบ' : 'จัดซื้อ';
  const canReceive = isGoodsReceiptDocument ? workflowAction === 'recipient' : doc?.status === 'delivered';
  const canEditInspector = workflowAction === 'inspector' && doc?.status === 'awaiting_purchasing';
  const canEditPurchasing = workflowAction === 'purchasing' && doc?.status === 'awaiting_recipient';

  // เติมค่าเริ่มต้นเมื่อโปรไฟล์โหลดเสร็จ แต่ไม่ทับค่าที่ผู้ใช้พิมพ์แล้ว
  useEffect(() => {
    if (!signatureTouched && profile?.full_name) setSignature(profile.full_name);
  }, [profile?.full_name, signatureTouched]);

  useEffect(() => {
    const loadDoc = async () => {
      try {
        const res = await window.fetch(`/api/documents/${docId}`);
        const data = await res.json();
        if (data.success) {
          setDoc(data.data);
          // Check if already signed via delivery logs
          const deliveryRes = await window.fetch('/api/deliveries?document_recipient_id=' + docId);
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
    if (docId) loadDoc();
  }, [docId]);

  const handleSubmit = async () => {
    if (!signature.trim()) {
      setError('กรุณาระบุชื่อผู้รับเอกสาร');
      return;
    }
    setSubmitting(true);
    setError('');

    const res = await fetch('/api/deliveries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document_recipient_id: docId,
        is_verified: verified,
        recipient_signature: signature.trim(),
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

  const handleApproval = async () => {
    if (!approvalStage || !signature.trim()) {
      setError(`กรุณาระบุชื่อ${approvalLabel}`);
      return;
    }
    setSubmitting(true);
    setError('');
    const res = await fetch(`/api/documents/${docId}/sign`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [approvalStage]: signature.trim() }),
    });
    const data = await res.json();
    if (data.success) {
      setDoc(data.data);
      setNotice(`✅ บันทึกชื่อ${approvalLabel}แล้ว`);
      setSuccess('');
      setEditingApprovalStage(null);
      setSignature(profile?.full_name || '');
      setSignatureTouched(false);
    } else {
      setError(data.error || 'เกิดข้อผิดพลาด');
    }
    setSubmitting(false);
  };

  if (loading) return <div className="loading-screen">กำลังโหลด...</div>;
  if (!doc) return <div className="loading-screen">ไม่พบเอกสาร</div>;

  // A goods receipt must move through inspector and purchasing before the
  // receiving signature becomes available. Other document types receive directly.
  if (!approvalStage && !canReceive && !success) {
    const isRejected = doc.status === 'rejected';
    return (
      <div className="scan-panel" style={{ maxWidth: 580, margin: '40px auto' }}>
        <div className="app-title" style={{ textAlign: 'center' }}>
          <div className="title-badge">{isRejected ? '⚠️ แจ้งปัญหาแล้ว' : '✅ ดำเนินการแล้ว'}</div>
          <h3>{isRejected ? 'เอกสารนี้ถูกแจ้งปัญหาไว้ รอหน่วยงานจัดส่งใหม่' : 'เอกสารนี้ได้รับการดำเนินการแล้ว'}</h3>
        </div>
        {existingDelivery && (
          <div style={{ marginTop: 16, textAlign: 'center', color: 'var(--muted)' }}>
            ลงชื่อรับเมื่อ: {new Date(existingDelivery.recipient_signed_at).toLocaleString('th-TH')}
          </div>
        )}
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
            <div style={{ fontWeight: 800, fontSize: '1.2rem' }}>{documentNo(doc)}</div>
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
          {isGoodsReceiptDocument && (
            <div className="field-control">
              <span>ขั้นตอนปัจจุบัน</span>
              <div style={{ fontWeight: 700 }}>
                {doc.status === 'awaiting_inspector' ? 'รอผู้ตรวจสอบ'
                  : doc.status === 'awaiting_purchasing' ? 'รอจัดซื้อ'
                    : doc.status === 'awaiting_recipient' ? 'รอผู้รับ'
                      : doc.status}
              </div>
            </div>
          )}
          {doc.related_department_names?.length > 0 && (
            <div className="field-control">
              <span>หน่วยงานกำกับเอกสาร</span>
              <div style={{ fontWeight: 700 }}>{doc.related_department_names.join(', ')}</div>
            </div>
          )}
          {doc.inspector_signature && (
            <div className="field-control">
              <span>ผู้ตรวจสอบ</span>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <strong>{doc.inspector_signature}</strong>
                {canEditInspector && (
                  <button className="ghost-button" style={{ width: 'auto', padding: '0 10px', minHeight: 30 }} onClick={() => { setEditingApprovalStage('inspector_signature'); setSignature(doc.inspector_signature); setSignatureTouched(true); setError(''); }}>
                    ✏️ แก้ไข
                  </button>
                )}
              </div>
            </div>
          )}
          {doc.purchasing_signature && (
            <div className="field-control">
              <span>จัดซื้อ</span>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <strong>{doc.purchasing_signature}</strong>
                {canEditPurchasing && (
                  <button className="ghost-button" style={{ width: 'auto', padding: '0 10px', minHeight: 30 }} onClick={() => { setEditingApprovalStage('purchasing_signature'); setSignature(doc.purchasing_signature); setSignatureTouched(true); setError(''); }}>
                    ✏️ แก้ไข
                  </button>
                )}
              </div>
            </div>
          )}
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

        {canReceive && !approvalStage && <div className="form-group">
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
        </div>}

        {canReceive && !approvalStage && !verified && (
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

        {/* ลายเซ็นพิมพ์ได้ เพราะคนที่มารับของจริงอาจไม่ใช่เจ้าของบัญชีที่ล็อกอิน
            (ฝากเพื่อนแผนกมารับ) บังคับใช้ชื่อบัญชีจะทำให้หลักฐานระบุคนผิด
            ระบบยังเก็บบัญชีที่กดยืนยันไว้เสมอ จึงตามหาคนที่กดได้ทุกกรณี */}
        {(approvalStage || (canReceive && !approvalStage)) && <div className="form-group" style={{ marginTop: 16 }}>
          <label htmlFor="recipient-signature">✍️ {approvalStage ? `ชื่อ${approvalLabel}` : 'ลายเซ็นผู้รับ'} *</label>
          <input
            id="recipient-signature"
            type="text"
            value={signature}
            onChange={(e) => {
              setSignature(e.target.value);
              setSignatureTouched(true);
            }}
            placeholder={approvalStage ? `พิมพ์ชื่อ${approvalLabel}` : 'พิมพ์ชื่อผู้รับเอกสาร'}
            maxLength={255}
            style={{ fontFamily: 'Caveat, cursive', fontSize: '1.4rem', minHeight: 48 }}
          />
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: 4 }}>
            {approvalStage ? `พิมพ์ชื่อ${approvalLabel}ได้ และระบบเก็บบัญชีที่กดยืนยันพร้อมเวลาไว้` : 'เติมชื่อจากบัญชีที่ล็อกอินไว้ให้แล้ว แก้เป็นชื่อผู้รับตัวจริงได้'}
            {!approvalStage && profile?.full_name && signature.trim() && signature.trim() !== profile.full_name && (
              <> · บันทึกว่าบัญชี {profile.full_name} เป็นผู้กดยืนยัน</>
            )}
          </div>
          {editingApprovalStage && (
            <button className="ghost-button" style={{ width: 'auto', marginTop: 8, padding: '0 12px' }} onClick={() => { setEditingApprovalStage(null); setSignature(profile?.full_name || ''); setSignatureTouched(false); }}>
              ยกเลิกการแก้ไข
            </button>
          )}
        </div>}

        {notice && <div className="toast success" style={{ position: 'static', marginBottom: 8 }}>{notice}</div>}
        {success && <div className="toast success" style={{ position: 'static', marginBottom: 8 }}>{success}</div>}
        {error && <div className="toast error" style={{ position: 'static', marginBottom: 8 }}>{error}</div>}

        {(!success || approvalStage) && (
          <button
            className="secondary-button"
            onClick={approvalStage ? handleApproval : handleSubmit}
            disabled={submitting}
            style={{ marginTop: 12 }}
          >
            {submitting ? 'กำลังดำเนินการ...' : approvalStage ? `✅ ยืนยัน${approvalLabel}` : verified ? '✅ ยืนยันรับเอกสาร' : '⚠️ แจ้งปัญหา'}
          </button>
        )}
      </div>
    </div>
  );
}
