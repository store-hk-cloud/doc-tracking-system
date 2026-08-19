'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  amountsMatch,
  clearDraft,
  formatBahtDisplay,
  getGeoStamp,
  loadDraft,
  saveDraft,
  uploadJobPhoto,
  type GeoStamp,
} from '@/lib/field-capture';

type Lookup = {
  branches: { id: string; name: string; code: string }[];
  cashiers: { id: string; full_name: string }[];
};

/**
 * SCREEN 1 — จุดรับเงินจากแคชเชียร์
 *
 * ยอดที่กรอกที่นี่คือฐานของการเทียบยอดทั้งหมด และแก้ย้อนหลังไม่ได้ (write-once
 * ที่ระดับ trigger) จึงบังคับ double-entry: พิมพ์ยอดสองครั้งให้ตรงกันก่อนส่ง
 */
export default function CashPickupPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const router = useRouter();

  const [job, setJob] = useState<any>(null);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState('');

  const [cashierProfileId, setCashierProfileId] = useState('');
  const [cashierName, setCashierName] = useState('');
  const [envelopeCount, setEnvelopeCount] = useState('1');
  const [amount, setAmount] = useState('');
  const [amountConfirm, setAmountConfirm] = useState('');

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [showFullPreview, setShowFullPreview] = useState(false);
  const [geo, setGeo] = useState<GeoStamp>(null);
  const previewRef = useRef('');

  const draftKey = `pickup:${jobId}`;

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
          // บันทึกการรับเงินไปแล้ว — ไปหน้าถัดไป ไม่ให้บันทึกซ้ำ
          if (runRes.data.pickup) router.replace(`/messenger/${jobId}/deposit`);
        }
        if (lookupRes.success) setLookup(lookupRes.data);
        setLoading(false);
      })
      .catch(() => {
        setError('เชื่อมต่อไม่สำเร็จ');
        setLoading(false);
      });

    // ขอ GPS ทันทีที่เข้าหน้า เพื่อให้ได้พิกัดตอนอยู่หน้าเคาน์เตอร์จริง
    getGeoStamp().then(setGeo);

    const draft = loadDraft<{ cashierName: string; envelopeCount: string; amount: string }>(draftKey);
    if (draft) {
      setCashierName(draft.cashierName || '');
      setEnvelopeCount(draft.envelopeCount || '1');
      setAmount(draft.amount || '');
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
    // ต้องล้างค่าทันที ไม่งั้นถ่ายรูปเดิมซ้ำจะไม่ trigger onChange
    e.target.value = '';
    if (!file) return;
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = URL.createObjectURL(file);
    previewRef.current = url;
    setPhotoFile(file);
    setPhotoPreview(url);
  };

  const amountOk = amountsMatch(amount, amountConfirm);
  const canSubmit =
    !!photoFile && !!cashierName.trim() && amountOk && Number(envelopeCount) >= 1 && !saving;

  const handleSubmit = async () => {
    if (!canSubmit || !photoFile) return;
    setSaving(true);
    setError('');

    // เขียน draft ก่อนแตะ network เสมอ — แอปถูก kill กลางทางยังกู้ได้
    saveDraft(draftKey, { cashierName, envelopeCount, amount });

    try {
      setStep('กำลังอัปโหลดรูปใบ Pay-in...');
      const photo = await uploadJobPhoto(jobId, photoFile, 'payin_slip', geo, 'ใบ Pay-in / ซองเงิน');

      setStep('กำลังบันทึกการรับมอบ...');
      const res = await fetch(`/api/messenger/runs/${jobId}/pickup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cashier_profile_id: cashierProfileId || null,
          cashier_name: cashierName.trim(),
          envelope_count: Number(envelopeCount),
          payin_amount: amount,
          payin_photo_id: photo.id,
          lat: geo?.lat ?? null,
          lng: geo?.lng ?? null,
          gps_accuracy_m: geo?.accuracy ?? null,
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
      router.replace(`/messenger/${jobId}/deposit`);
    } catch (e: any) {
      setError(e?.message || 'บันทึกไม่สำเร็จ');
      setSaving(false);
      setStep('');
    }
  };

  if (loading) return <div className="loading-screen">Loading...</div>;

  return (
    <div>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="title-badge">📥 จุดรับเงิน</div>
        <h2>รับเงินจากแคชเชียร์{job?.branch_name ? ` · ${job.branch_name}` : ''}</h2>
        <div className="title-accent" />
      </div>

      <div className="scan-panel">
        <div className="form-group">
          <label htmlFor="cashier-select">ชื่อแคชเชียร์ผู้ส่งมอบ *</label>
          <select
            id="cashier-select"
            value={cashierProfileId}
            onChange={(e) => {
              const id = e.target.value;
              setCashierProfileId(id);
              const found = lookup?.cashiers.find((c) => c.id === id);
              if (found) setCashierName(found.full_name);
            }}
          >
            <option value="">-- เลือกจากรายชื่อ หรือพิมพ์ด้านล่าง --</option>
            {(lookup?.cashiers || []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={cashierName}
            onChange={(e) => {
              setCashierName(e.target.value);
              setCashierProfileId('');
            }}
            placeholder="หรือพิมพ์ชื่อแคชเชียร์"
            style={{ marginTop: 8 }}
          />
        </div>

        <div className="form-group">
          <label htmlFor="envelopes">จำนวนซองที่รับ *</label>
          <input
            id="envelopes"
            type="text"
            inputMode="numeric"
            value={envelopeCount}
            onChange={(e) => setEnvelopeCount(e.target.value.replace(/\D/g, ''))}
          />
        </div>

        {/* type="text" + inputMode ไม่ใช่ type="number" เพราะ number เลื่อนค่าเพี้ยน
            ตอนสไครลล์ด้วยนิ้วโป้ง และรูปแบบทศนิยมต่างกันตาม locale */}
        <div className="form-group">
          <label htmlFor="amount">ยอดเงินตามใบ Pay-in (บาท) *</label>
          <input
            id="amount"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="เช่น 45000.00"
            style={{ fontSize: '1.25rem', fontWeight: 700 }}
          />
        </div>

        <div className="form-group">
          <label htmlFor="amount-confirm">พิมพ์ยอดอีกครั้งเพื่อยืนยัน *</label>
          <input
            id="amount-confirm"
            type="text"
            inputMode="decimal"
            value={amountConfirm}
            onChange={(e) => setAmountConfirm(e.target.value)}
            placeholder="พิมพ์ยอดเดิมซ้ำ"
            style={{ fontSize: '1.25rem', fontWeight: 700 }}
          />
          {amountConfirm && !amountOk && (
            <div style={{ color: 'var(--text)', fontSize: '0.85rem', marginTop: 4 }}>
              ⚠️ ยอดสองช่องไม่ตรงกัน — ยอดนี้แก้ย้อนหลังไม่ได้ กรุณาตรวจให้ตรงก่อน
            </div>
          )}
          {amountOk && (
            <div style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: 4 }}>
              ยอดที่จะบันทึก: <strong style={{ color: 'var(--text)' }}>{formatBahtDisplay(amount)} บาท</strong>
            </div>
          )}
        </div>

        <div className="form-group">
          <label>รูปซองเงิน / ใบ Pay-in *</label>
          <label
            htmlFor="payin-photo"
            className="ghost-button"
            style={{ display: 'inline-flex', minHeight: 64, fontSize: '1.05rem', cursor: 'pointer', width: '100%', justifyContent: 'center' }}
          >
            📷 {photoFile ? 'ถ่ายใหม่' : 'ถ่ายรูปใบ Pay-in'}
          </label>
          <input
            id="payin-photo"
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
                alt="ตัวอย่างรูปใบ Pay-in"
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

        <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
          {geo
            ? `📍 บันทึกพิกัดแล้ว (ความแม่นยำ ~${Math.round(geo.accuracy)} ม.)`
            : '📍 ยังไม่ได้พิกัด GPS — บันทึกงานได้ แต่ระบบจะไม่มีพิกัดเป็นหลักฐาน'}
        </div>

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
              ? `✅ ยืนยันรับมอบ ${formatBahtDisplay(amount)} บาท`
              : '✅ ยืนยันรับมอบ'}
        </button>
        <Link href="/messenger" className="ghost-button" style={{ justifyContent: 'center' }}>
          กลับไปคิวงาน
        </Link>
      </div>

      {showFullPreview && photoPreview && (
        <div className="scan-popup-overlay" onClick={() => setShowFullPreview(false)}>
          <div className="scan-popup-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="scan-popup-handle" />
            <img src={photoPreview} alt="รูปใบ Pay-in เต็มจอ" style={{ width: '100%', borderRadius: 'var(--radius-sm)' }} />
            <button type="button" className="scan-popup-close" onClick={() => setShowFullPreview(false)}>
              ปิด
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
