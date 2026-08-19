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
  // ทริปหนึ่งมีได้หลายจุดรับ ยอดที่ควรฝากคือผลรวมของทุกจุด
  const [pickups, setPickups] = useState<any[]>([]);
  const [expectedTotal, setExpectedTotal] = useState(0);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState('');
  const [showExpected, setShowExpected] = useState(false);

  const [bankId, setBankId] = useState('');
  const [bankBranchId, setBankBranchId] = useState('');
  const [bankBranch, setBankBranch] = useState('');
  const [bankBranches, setBankBranches] = useState<any[]>([]);
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
          setPickups(runRes.data.pickups || []);
          setExpectedTotal(runRes.data.expected_total_satang || 0);
          if (!runRes.data.pickups || runRes.data.pickups.length === 0) {
            // ยังไม่ได้เก็บซองเลย — ต้องรับซองก่อน
            router.replace(`/messenger/${jobId}/pickup`);
          } else if (runRes.data.deposit) {
            // บันทึกฝากไปแล้ว — เข้าหน้านี้ตรง ๆ ไม่ได้ ต้องไปหน้าผล
            // นี่คือส่วนหนึ่งของการล็อกเคสยอดเกิน: ห้ามย้อนมาคีย์ใหม่ให้ตรง
            router.replace(`/messenger/${jobId}/result`);
          }
        }
        if (lookupRes.success) {
          setBanks(lookupRes.data.banks);
          setBankBranches(lookupRes.data.bank_branches || []);
        }
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
  // เลขที่ใบนำฝากไม่บังคับแล้ว — ใบ Pay-in ไม่มีเลขรัน ระบบออกเลขให้เองได้
  // สาขาธนาคารเลือกจากรายชื่อ หรือพิมพ์ชื่อใหม่ (ระบบจะเพิ่มเข้ารายชื่อให้เอง)
  const branchOptions = bankBranches.filter((b) => b.bank_id === bankId);
  const canSubmit =
    !!photoFile && !!bankId && (!!bankBranchId || !!bankBranch.trim()) && amountOk && !saving;

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
          bank_branch_id: bankBranchId || null,
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
          <select
            id="bank"
            value={bankId}
            onChange={(e) => {
              setBankId(e.target.value);
              // เปลี่ยนธนาคารแล้วสาขาเดิมใช้ไม่ได้ (DB ปฏิเสธสาขาข้ามธนาคาร)
              setBankBranchId('');
              setBankBranch('');
            }}
          >
            <option value="">-- เลือกธนาคาร --</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        {/* สาขาธนาคาร: เลือกจากรายชื่อที่ฝ่ายบัญชีดูแลเป็นทางหลัก แต่พิมพ์เองได้
            ถ้าไปฝากสาขาที่ยังไม่มีในรายชื่อ — ห้ามบล็อก เพราะเงินออกไปแล้ว */}
        <div className="form-group">
          <label htmlFor="bank-branch-select">สาขาธนาคารที่ไปฝาก *</label>
          <select
            id="bank-branch-select"
            value={bankBranchId}
            onChange={(e) => {
              setBankBranchId(e.target.value);
              if (e.target.value) setBankBranch('');
            }}
            disabled={!bankId}
          >
            <option value="">
              {!bankId
                ? '-- เลือกธนาคารก่อน --'
                : branchOptions.length === 0
                  ? '-- ยังไม่มีรายชื่อสาขา พิมพ์ด้านล่าง --'
                  : '-- เลือกสาขา หรือพิมพ์ด้านล่าง --'}
            </option>
            {branchOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.branch_code ? ` (${b.branch_code})` : ''}
              </option>
            ))}
          </select>
          {!bankBranchId && (
            <>
              <input
                type="text"
                value={bankBranch}
                onChange={(e) => setBankBranch(e.target.value)}
                placeholder="หรือพิมพ์ชื่อสาขาที่ไปฝาก"
                style={{ marginTop: 8 }}
              />
              <div style={{ fontSize: '0.82rem', color: 'var(--muted)', marginTop: 4 }}>
                สาขาที่พิมพ์เองจะถูกทำเครื่องหมายให้ฝ่ายบัญชีตรวจและเพิ่มเข้ารายชื่อ
              </div>
            </>
          )}
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
          <label htmlFor="ref">เลขที่ใบนำฝาก (ถ้ามี)</label>
          <input
            id="ref"
            type="text"
            value={referenceNo}
            onChange={(e) => setReferenceNo(e.target.value)}
            placeholder="เว้นว่างได้ถ้าหลักฐานไม่มีเลขรัน"
          />
          {/* ใบ Pay-in ไม่มีเลขรันมาให้ ถ้าเว้นว่างระบบจะออกเลขให้เอง
              และบันทึกไว้ว่าเป็นเลขที่ระบบออก ไม่ใช่ของธนาคาร */}
          <div style={{ fontSize: '0.82rem', color: 'var(--muted)', marginTop: 4 }}>
            {referenceNo.trim()
              ? 'บันทึกเป็นเลขจากหลักฐานของธนาคาร'
              : 'เว้นว่างไว้ ระบบจะออกเลขให้เองในรูปแบบ AUTO-YYMMDD-00001'}
          </div>
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
        {pickups.length > 0 && (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            {showExpected ? (
              <div style={{ fontSize: '0.95rem', color: 'var(--text)' }}>
                ยอดที่ต้องฝาก (รวม {pickups.length} จุดรับ):{' '}
                <strong>{formatSatangToBaht(expectedTotal)} บาท</strong>
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
