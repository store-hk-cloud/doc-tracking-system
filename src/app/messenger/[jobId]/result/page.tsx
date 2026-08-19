'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { classifyVariance, formatSatangToBaht } from '@/lib/money';
import { uploadJobPhoto } from '@/lib/field-capture';
import { VARIANCE_CAUSE_LABELS, type VarianceCauseCode } from '@/types';

const CAUSE_ORDER: VarianceCauseCode[] = [
  'bank_fee',
  'miscount_at_pickup',
  'damaged_note_rejected',
  'mixed_envelope',
  'wrong_account',
  'other',
];

/**
 * ผลเทียบยอด — สามหน้าตาที่ต่างกันชัดเจน
 *
 * ทำไมเป็น route ไม่ใช่ popup: `.scan-popup-overlay` ในหน้าอื่นของระบบมี
 * onClick ปิดที่ overlay จึงปัดออกได้ด้วยการแตะพลาดที่ขอบจอ ซึ่งเคสเงินเกิน
 * ยอมให้เกิดไม่ได้ route จริงยังทำให้กด back ของ Android ไม่ทำให้สถานะหาย
 * และรีเฟรช/ปิดแอปแล้วเปิดใหม่ก็ยังอยู่ที่เดิม
 */
export default function DepositResultPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const router = useRouter();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [causeCode, setCauseCode] = useState<VarianceCauseCode | ''>('');
  const [causeDetail, setCauseDetail] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [slipFile, setSlipFile] = useState<File | null>(null);

  const load = async () => {
    try {
      const res = await fetch(`/api/messenger/runs/${jobId}`);
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'ไม่พบงานนี้');
      } else if (!json.data.deposit) {
        router.replace(`/messenger/${jobId}/pickup`);
      } else {
        setData(json.data);
      }
    } catch {
      setError('เชื่อมต่อไม่สำเร็จ');
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  if (loading) return <div className="loading-screen">Loading...</div>;
  if (error) {
    return (
      <div className="scan-panel">
        <div className="toast error" style={{ position: 'static' }}>{error}</div>
      </div>
    );
  }

  const deposit = data.deposit;
  const report = data.report;
  const variance: number = deposit.variance_satang;
  const kind = classifyVariance(variance);
  const needsSlip = deposit.slip_status === 'pending';

  const handleAttachSlip = async () => {
    if (!slipFile) return;
    setSaving(true);
    setError('');
    try {
      const photo = await uploadJobPhoto(jobId, slipFile, 'deposit_slip', null, 'ใบนำฝากธนาคาร');
      const res = await fetch(`/api/messenger/runs/${jobId}/deposit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slip_photo_id: photo.id }),
      });
      const json = await res.json();
      if (!json.success) setError(json.error || 'แนบสลิปไม่สำเร็จ');
      else {
        setSlipFile(null);
        await load();
      }
    } catch (e: any) {
      setError(e?.message || 'แนบสลิปไม่สำเร็จ');
    }
    setSaving(false);
  };

  const handleSubmitReport = async () => {
    if (!causeCode || causeDetail.trim().length < 10) return;
    setSaving(true);
    setError('');
    try {
      if (docFile) {
        // เอกสารประกอบเป็นตัวเลือก อัปไม่ได้ก็ยังส่งรายงานได้
        try {
          await uploadJobPhoto(jobId, docFile, 'variance_doc', null, 'เอกสารประกอบผลต่าง');
        } catch {
          /* ไม่บล็อกการส่งรายงาน */
        }
      }
      const res = await fetch(`/api/messenger/runs/${jobId}/variance-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cause_code: causeCode, cause_detail: causeDetail.trim() }),
      });
      const json = await res.json();
      if (!json.success) setError(json.error || 'ส่งรายงานไม่สำเร็จ');
      else await load();
    } catch {
      setError('ส่งรายงานไม่สำเร็จ');
    }
    setSaving(false);
  };

  const amountRows = (
    <div className="variance-rows">
      <div className="variance-row">
        <span>ยอดที่ต้องฝาก</span>
        <span>{formatSatangToBaht(deposit.expected_total_satang)}</span>
      </div>
      <div className="variance-row">
        <span>ยอดที่ฝากจริง</span>
        <span>{formatSatangToBaht(deposit.actual_amount_satang)}</span>
      </div>
    </div>
  );

  return (
    <div>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="title-badge">
          {kind === 'match' ? '✅ ยอดตรง' : kind === 'short' ? '⚠️ ยอดขาด' : '🚨 ยอดเกิน — ต้องรออนุมัติ'}
        </div>
        <h2>ผลการเทียบยอด · งาน #{data.job.job_no}</h2>
        <div className="title-accent" />
      </div>

      <div className="scan-panel">
        {kind === 'match' && (
          <div className="variance-box match">
            <span className="variance-icon">✅</span>
            <span className="variance-headline">ยอดตรงกันพอดี</span>
            <span className="variance-note">
              {formatSatangToBaht(deposit.actual_amount_satang)} บาท · {deposit.bank_name}
            </span>
            {amountRows}
          </div>
        )}

        {kind === 'short' && (
          <div className="variance-box short">
            <span className="variance-icon">⚠️</span>
            <span className="variance-headline">ยอดขาด {formatSatangToBaht(-variance)} บาท</span>
            <span className="variance-note">ต้องระบุสาเหตุและส่งให้ฝ่ายการเงินตรวจสอบ</span>
            {amountRows}
          </div>
        )}

        {kind === 'over' && (
          <div className="variance-box over">
            <span className="variance-icon">🚨</span>
            <span className="variance-headline">ยอดเกิน {formatSatangToBaht(variance)} บาท</span>
            {amountRows}
            <div style={{ marginTop: 10 }}>
              <span className="status-badge locked">ล็อก — รออนุมัติ</span>
            </div>
            <span style={{ fontSize: '0.9rem', color: 'var(--text)', marginTop: 6 }}>
              รายการนี้ถูกล็อกไว้ ปิดงานเองไม่ได้
              <br />
              ต้องให้ผู้อนุมัติของฝ่ายการเงินตรวจสอบก่อน
            </span>
          </div>
        )}

        <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: 12 }}>
          {deposit.bank_name} · สาขา {deposit.bank_branch_name} · เลขที่ใบนำฝาก {deposit.reference_no}
        </div>

        {/* รอแนบสลิป: เป็นสถานะจริงที่การเงินเห็น และปิดงานไม่ได้จนกว่าจะมีรูป */}
        {needsSlip && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <div className="status-badge awaiting" style={{ marginBottom: 8 }}>
              รอแนบสลิป
            </div>
            <div style={{ fontSize: '0.9rem', color: 'var(--text)', marginBottom: 8 }}>
              ยอดเงินถูกบันทึกไว้แล้ว แต่ยังไม่มีรูปใบนำฝาก — งานนี้ปิดไม่ได้จนกว่าจะแนบรูป
            </div>
            <label
              htmlFor="retry-slip"
              className="ghost-button"
              style={{ display: 'inline-flex', minHeight: 56, cursor: 'pointer', width: '100%', justifyContent: 'center' }}
            >
              📷 {slipFile ? 'เลือกรูปใหม่' : 'ถ่ายรูปใบนำฝาก'}
            </label>
            <input
              id="retry-slip"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) setSlipFile(f);
              }}
              style={{ display: 'none' }}
            />
            {slipFile && (
              <button
                type="button"
                className="secondary-button"
                onClick={handleAttachSlip}
                disabled={saving}
                style={{ marginTop: 8, width: '100%', minHeight: 52 }}
              >
                {saving ? 'กำลังแนบ...' : '📤 แนบรูปใบนำฝาก'}
              </button>
            )}
          </div>
        )}

        {/* SCREEN 3 — รายงานผลต่าง (ยังไม่ได้ส่ง) */}
        {kind !== 'match' && !report && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <div className="form-group">
              <label htmlFor="cause">สาเหตุเบื้องต้น *</label>
              <select id="cause" value={causeCode} onChange={(e) => setCauseCode(e.target.value as VarianceCauseCode)}>
                <option value="">-- เลือกสาเหตุ --</option>
                {CAUSE_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {VARIANCE_CAUSE_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="detail">
                {kind === 'over' ? 'คำชี้แจงของคุณ (ส่งให้ผู้อนุมัติ) *' : 'รายละเอียด *'}
              </label>
              <textarea
                id="detail"
                rows={4}
                minLength={10}
                value={causeDetail}
                onChange={(e) => setCauseDetail(e.target.value)}
                placeholder="อธิบายอย่างน้อย 10 ตัวอักษร"
              />
              <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                {causeDetail.trim().length}/10 ตัวอักษรขั้นต่ำ
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="var-doc">แนบรูปเอกสารประกอบ (ถ้ามี)</label>
              <label
                htmlFor="var-doc"
                className="ghost-button"
                style={{ display: 'inline-flex', minHeight: 48, cursor: 'pointer', width: '100%', justifyContent: 'center' }}
              >
                📎 {docFile ? docFile.name.slice(0, 24) : 'เลือก/ถ่ายรูปเอกสาร'}
              </label>
              <input
                id="var-doc"
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) setDocFile(f);
                }}
                style={{ display: 'none' }}
              />
            </div>
          </div>
        )}

        {/* ส่งรายงานแล้ว — ไม่มีปุ่มยกเลิก ไม่มีปุ่มแก้ยอด ไม่มีปุ่มถ่ายสลิปใหม่ */}
        {report && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <div className="empty-search" style={{ textAlign: 'left' }}>
              ส่งเรื่องแล้ว{' '}
              {new Date(report.reported_at).toLocaleString('th-TH', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              · {report.status === 'pending_review' ? 'รอฝ่ายการเงินตรวจสอบ' : 'ฝ่ายการเงินตัดสินแล้ว'}
              <div style={{ marginTop: 6, color: 'var(--text)' }}>
                สาเหตุ: {VARIANCE_CAUSE_LABELS[report.cause_code as VarianceCauseCode]} — {report.cause_detail}
              </div>
            </div>
            {data.reviews?.length > 0 && (
              <div className="audit-list" style={{ marginTop: 12 }}>
                {data.reviews.map((r: any) => (
                  <div key={r.id} className="audit-row">
                    <span className="audit-when">
                      {new Date(r.created_at).toLocaleString('th-TH')}
                    </span>
                    <span className="audit-who">
                      {r.reviewer_signature} ({r.reviewer_dept_code || r.reviewer_role})
                    </span>
                    <span>
                      {r.decision === 'approved' ? 'อนุมัติ' : r.decision === 'rejected' ? 'ไม่อนุมัติ' : 'ตีกลับให้แก้'}
                      : {r.reason}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="toast error" style={{ position: 'static', marginTop: 12 }}>
            {error}
          </div>
        )}
      </div>

      <div className="job-action-bar">
        {kind !== 'match' && !report && (
          <button
            type="button"
            className="secondary-button"
            onClick={handleSubmitReport}
            disabled={saving || !causeCode || causeDetail.trim().length < 10}
          >
            {saving
              ? 'กำลังส่ง...'
              : kind === 'over'
                ? '📤 ส่งให้การเงินตรวจสอบ'
                : '📤 ส่งรายงานยอดขาด'}
          </button>
        )}

        {/* ทางออกที่สร้างสรรค์ ไม่ใช่ทางออกที่กลบเรื่อง */}
        {kind === 'over' && (
          <a href="tel:" className="ghost-button" style={{ justifyContent: 'center' }}>
            📞 โทรแจ้งฝ่ายการเงิน
          </a>
        )}

        <Link href="/messenger" className="ghost-button" style={{ justifyContent: 'center' }}>
          กลับไปคิวงาน
        </Link>
      </div>
    </div>
  );
}
