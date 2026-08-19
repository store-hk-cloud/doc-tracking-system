'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatSatangToBaht } from '@/lib/money';
import {
  amountsMatch,
  clearDraft,
  formatBahtDisplay,
  loadDraft,
  saveDraft,
  uploadJobPhoto,
} from '@/lib/field-capture';

type Bank = { id: string; name: string; code: string };

/**
 * SCREEN 2 — นำฝากธนาคาร
 *
 * สองเรื่องที่สำคัญที่สุดในหน้านี้:
 *
 * 1. ยอดที่ควรฝากถูก "ซ่อน" ไว้ ให้คีย์ตามสลิปจริงก่อน เพื่อไม่ให้เกิดอาการ
 *    คีย์ตามยอดที่ควรเป็นเพราะเห็นอยู่บนจอ (ระบบเทียบยอดที่ backend อยู่แล้ว)
 *    การกดดูถูกบันทึกไว้ในรูปของ audit ผ่าน API เมื่อกดปุ่มเปิดดู
 *
 * 2. "บันทึกยอด" กับ "แนบรูปสลิป" เป็นสองธุรกรรม: ยอดเงินเป็น payload ไม่กี่ร้อย
 *    ไบต์ที่ผ่านสัญญาณแย่ได้ ส่วนรูปคือครึ่งเมกะไบต์ที่ล้มบ่อย ถ้าผูกไว้ด้วยกัน
 *    รูปล้ม = ยอดเงินไม่ถูกบันทึกเลย ซึ่งเป็นผลลัพธ์ที่แย่ที่สุดเพราะเงินออกไปแล้ว
 *    ถ้ารูปล้ม ระบบยังบันทึกยอดและล็อกผลต่างไว้ แล้วค้างสถานะ "รอแนบสลิป"
 *    ซึ่งปิดงานไม่ได้จนกว่าจะมีรูป
 */
export default function BankDepositPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const router = useRouter();

  const [job, setJob] = useState<any>(null);
  const [pickup, setPickup] = useState<any>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState('');
  const [showExpected, setShowExpected] = useState(false);

  const [bankId, setBankId] = useState('');
  const [bankBranch, setBankBranch] = useState('');
  const [amount, setAmount] = useState('');
  const [amountConfirm, setAmountConfirm] = useState('');
  const [referenceNo, setReferenceNo] = useState('');

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [showFullPreview, setShowFullPreview] = useState(false);
  const previewRef = useRef('');

  const draftKey = `deposit:${jobId}`;

  useEffect(() => {
    Promise.all([
      fetch(`/api/messenger/runs/${jobId}`).then((r) => r.json()),
      fetch('/api/messenger/lookups').then((r) => r.json()),
    ])
      .then(([runRes, lookupRes]) => {
        if (!runRes.success) {
          setError(runRes.error || 'ไม่พบงานนี้');
        } else {
          setJob(runRes.data.job);
          setPickup(runRes.data.pickup);
          if (!runRes.data.pickup) {
            // ยังไม่ได้รับเงิน — ต้องทำ Screen 1 ก่อน
            router.replace(`/messenger/${jobId}/pickup`);
          } else if (runRes.data.deposit) {
            // บันทึกฝากไปแล้ว — เข้าหน้านี้ตรง ๆ ไม่ได้ ต้องไปหน้าผล
            // นี่คือส่วนหนึ่งของการล็อกเคสยอดเกิน: ห้ามย้อนมาคีย์ใหม่ให้ตรง
            router.replace(`/messenger/${jobId}/result`);
          }
        }
        if (lookupRes.success) setBanks(lookupRes.data.banks);
        setLoading(false);
      })
      .catch(() => {
        setError('เชื่อมต่อไม่สำเร็จ');
        setLoading(false);
      });

    const draft = loadDraft<{ bankBranch: string; amount: string; referenceNo: string }>(draftKey);
    if (draft) {
      setBankBranch(draft.bankBranch || '');
      setAmount(draft.amount || '');
      setReferenceNo(draft.referenceNo || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = URL.createObjectURL(file);
    previewRef.current = url;
    setPhotoFile(file);
    setPhotoPreview(url);
  };

  const amountOk = amountsMatch(amount, amountConfirm);
  const canSubmit = !!photoFile && !!bankId && !!bankBranch.trim() && !!referenceNo.trim() && amountOk && !saving;

  const handleSubmit = async () => {
    if (!canSubmit || !photoFile) return;
    setSaving(true);
    setError('');
    saveDraft(draftKey, { bankBranch, amount, referenceNo });

    // ขาที่ 1: อัปรูปก่อน (ถ้าได้) — ถ้าล้ม เรายังบันทึกยอดต่อโดยไม่มีรูป
    let slipPhotoId: string | null = null;
    try {
      setStep('กำลังอัปโหลดรูปใบนำฝาก...');
      const photo = await uploadJobPhoto(jobId, photoFile, 'deposit_slip', null, 'ใบนำฝากธนาคาร');
      slipPhotoId = photo.id;
    } catch (e: any) {
      // ไม่หยุดที่นี่ เพราะเงินฝากไปแล้วจริง ยอดต้องเข้าระบบให้ได้
      setStep('อัปรูปไม่สำเร็จ — กำลังบันทึกยอดเงินไว้ก่อน');
    }

    // ขาที่ 2: บันทึกยอด (payload เล็ก ผ่านสัญญาณแย่ได้)
    try {
      setStep('กำลังบันทึกยอดฝาก...');
      const res = await fetch(`/api/messenger/runs/${jobId}/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bank_id: bankId,
          bank_branch_name: bankBranch.trim(),
          actual_amount: amount,
          reference_no: referenceNo.trim(),
          slip_photo_id: slipPhotoId,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'บันทึกไม่สำเร็จ');
        setSaving(false);
        setStep('');
        return;
      }
      clearDraft(draftKey);
      // replace ไม่ใช่ push — กด back ต้องไม่กลับมาหน้าคีย์ยอดเพื่อ "ลองใหม่ให้ตรง"
      router.replace(`/messenger/${jobId}/result`);
    } catch {
      setError(
        'บันทึกยอดไม่สำเร็จ และเงินถูกฝากไปแล้ว — กรุณากดบันทึกอีกครั้งเมื่อมีสัญญาณ ' +
          'ถ้ายังไม่สำเร็จให้โทรแจ้งฝ่ายการเงินทันที'
      );
      setSaving(false);
      setStep('');
    }
  };

  if (loading) return <div className="loading-screen">Loading...</div>;

  return (
    <div>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="title-badge">🏦 นำฝากธนาคาร</div>
        <h2>บันทึกการนำฝาก{job?.branch_name ? ` · ${job.branch_name}` : ''}</h2>
        <div className="title-accent" />
      </div>

      <div className="scan-panel">
        <div className="form-group">
          <label htmlFor="bank">ธนาคาร * (เฉพาะที่บริษัทอนุมัติ)</label>
          <select id="bank" value={bankId} onChange={(e) => setBankId(e.target.value)}>
            <option value="">-- เลือกธนาคาร --</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="bank-branch">สาขา / สถานที่ที่ฝาก *</label>
          <input
            id="bank-branch"
            type="text"
            value={bankBranch}
            onChange={(e) => setBankBranch(e.target.value)}
            placeholder="เช่น สาขาเซ็นทรัลเชียงใหม่"
          />
        </div>

        <div className="form-group">
          <label htmlFor="deposit-amount">ยอดเงินฝากจริง ตามใบนำฝาก (บาท) *</label>
          <input
            id="deposit-amount"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="อ่านจากใบนำฝากที่ธนาคารออกให้"
            style={{ fontSize: '1.25rem', fontWeight: 700 }}
          />
        </div>

        <div className="form-group">
          <label htmlFor="deposit-amount-confirm">พิมพ์ยอดอีกครั้งเพื่อยืนยัน *</label>
          <input
            id="deposit-amount-confirm"
            type="text"
            inputMode="decimal"
            value={amountConfirm}
            onChange={(e) => setAmountConfirm(e.target.value)}
            style={{ fontSize: '1.25rem', fontWeight: 700 }}
          />
          {amountConfirm && !amountOk && (
            <div style={{ color: 'var(--text)', fontSize: '0.85rem', marginTop: 4 }}>
              ⚠️ ยอดสองช่องไม่ตรงกัน
            </div>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="ref">เลขที่ใบนำฝาก (Reference No.) *</label>
          <input
            id="ref"
            type="text"
            value={referenceNo}
            onChange={(e) => setReferenceNo(e.target.value)}
            placeholder="ตามที่ระบุบนใบนำฝาก"
          />
        </div>

        <div className="form-group">
          <label>รูปใบนำฝากธนาคาร *</label>
          <label
            htmlFor="slip-photo"
            className="ghost-button"
            style={{ display: 'inline-flex', minHeight: 64, fontSize: '1.05rem', cursor: 'pointer', width: '100%', justifyContent: 'center' }}
          >
            📷 {photoFile ? 'ถ่ายใหม่' : 'ถ่ายรูปใบนำฝาก'}
          </label>
          <input
            id="slip-photo"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoChange}
            style={{ display: 'none' }}
          />
          {photoPreview && (
            <div style={{ marginTop: 10 }}>
              <img
                src={photoPreview}
                alt="ตัวอย่างรูปใบนำฝาก"
                style={{ width: '100%', maxWidth: 320, borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)' }}
              />
              <button
                type="button"
                className="ghost-button"
                onClick={() => setShowFullPreview(true)}
                style={{ marginTop: 8, minHeight: 44 }}
              >
                🔍 ดูเต็มจอ (ตรวจว่าตัวเลขชัด)
              </button>
            </div>
          )}
        </div>

        {/* ยอดที่ควรฝากซ่อนไว้ ให้คีย์ตามสลิปจริงก่อน */}
        {pickup && (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            {showExpected ? (
              <div style={{ fontSize: '0.95rem', color: 'var(--text)' }}>
                ยอดที่ต้องฝากตามใบ Pay-in:{' '}
                <strong>{formatSatangToBaht(pickup.payin_amount_satang)} บาท</strong>
                <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: 2 }}>
                  การเปิดดูยอดนี้ถูกบันทึกไว้
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="ghost-button"
                onClick={() => setShowExpected(true)}
                style={{ minHeight: 44 }}
              >
                👁 ดูยอดที่ต้องฝาก (การกดถูกบันทึก)
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="toast error" style={{ position: 'static', marginTop: 12 }}>
            {error}
          </div>
        )}
        {step && (
          <div className="toast" style={{ position: 'static', marginTop: 12 }}>
            {step}
          </div>
        )}
      </div>

      <div className="job-action-bar">
        <button type="button" className="secondary-button" onClick={handleSubmit} disabled={!canSubmit}>
          {saving
            ? 'กำลังบันทึก...'
            : amountOk
              ? `✅ ยืนยันฝากเงิน ${formatBahtDisplay(amount)} บาท`
              : '✅ ยืนยันฝากเงิน'}
        </button>
        <Link href="/messenger" className="ghost-button" style={{ justifyContent: 'center' }}>
          กลับไปคิวงาน
        </Link>
      </div>

      {showFullPreview && photoPreview && (
        <div className="scan-popup-overlay" onClick={() => setShowFullPreview(false)}>
          <div className="scan-popup-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="scan-popup-handle" />
            <img src={photoPreview} alt="รูปใบนำฝากเต็มจอ" style={{ width: '100%', borderRadius: 'var(--radius-sm)' }} />
            <button type="button" className="scan-popup-close" onClick={() => setShowFullPreview(false)}>
              ปิด
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
