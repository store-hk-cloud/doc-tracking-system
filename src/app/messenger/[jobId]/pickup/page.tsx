'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatSatangToBaht } from '@/lib/money';
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
  branches: { id: string; name: string; code: string; department_id: string | null }[];
  cashiers: { id: string; full_name: string; department_id: string | null }[];
};

/**
 * จุดรับซองเงินจากแคชเชียร์สาขา — บันทึกได้หลายจุดต่อหนึ่งทริป
 *
 * ยอดที่กรอกคือ **ยอดที่เขียนบนหน้าซอง** ไม่ใช่ยอดจากใบ Pay-in เพราะใบ Pay-in
 * อยู่ในซองและแกะดูไม่ได้จนถึงเคาน์เตอร์ธนาคาร รูปที่ถ่ายจึงเป็นรูปซอง
 *
 * ยอดนี้คือฐานของการเทียบยอดทั้งหมด และแก้ย้อนหลังไม่ได้ (write-once ที่ระดับ
 * trigger) จึงบังคับ double-entry: พิมพ์ยอดสองครั้งให้ตรงกันก่อนส่ง
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

  // ซองที่แคชเชียร์ส่งไว้ในระบบ — เส้นทางหลัก ยอดมาจากแคชเชียร์ คีย์เองไม่ได้
  const [handovers, setHandovers] = useState<any[]>([]);
  const [handoverId, setHandoverId] = useState('');
  const [faceValueOk, setFaceValueOk] = useState(false);
  const [branchId, setBranchId] = useState('');
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
  const [pickups, setPickups] = useState<any[]>([]);

  const draftKey = `pickup:${jobId}`;

  useEffect(() => {
    Promise.all([
      fetch(`/api/messenger/runs/${jobId}`).then((r) => r.json()),
      fetch('/api/messenger/lookups').then((r) => r.json()),
      fetch('/api/cashier/handovers?status=pending').then((r) => r.json()),
    ])
      .then(([runRes, lookupRes, handoverRes]) => {
        if (handoverRes?.success) setHandovers(handoverRes.data || []);
        if (!runRes.success) {
          setError(runRes.error || 'ไม่พบงานนี้');
        } else {
          setJob(runRes.data.job);
          setPickups(runRes.data.pickups || []);
          // ฝากเงินไปแล้ว = ยอดที่ควรฝากถูก snapshot ไว้ เพิ่มจุดรับอีกไม่ได้
          if (runRes.data.deposit) router.replace(`/messenger/${jobId}/result`);
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
  const selectedHandover = handovers.find((h) => h.id === handoverId) || null;
  // เมื่อรับซองที่แคชเชียร์ส่งไว้ ไม่ต้องคีย์ยอด/ชื่อ/จำนวนซองเลย
  // เหลือแค่ถ่ายรูปซอง และติ๊กยืนยันว่ายอดในระบบตรงกับที่เขียนหน้าซอง
  const canSubmit = selectedHandover
    ? !!photoFile && faceValueOk && !saving
    : !!branchId && !!photoFile && !!cashierName.trim() && amountOk && Number(envelopeCount) >= 1 && !saving;
  // สาขาที่เก็บไปแล้วในทริปนี้ ห้ามเลือกซ้ำ (DB มี unique (job_id, branch_id) กันอีกชั้น)
  const takenBranchIds = new Set(pickups.map((p) => p.branch_id));

  // กรองรายชื่อแคชเชียร์ตามหน่วยงานเจ้าของสาขาที่เลือก — ถ้าไม่กรอง พอมีแคชเชียร์
  // ครบทุกสาขาจะได้รายชื่อคละกันทั้งบริษัท แล้วเลือกผิดคนง่ายตอนรีบหน้าเคาน์เตอร์
  // ถ้าสาขานั้นไม่มีใครในหน่วยงาน คืนรายชื่อทั้งหมดไว้ ไม่ให้ตันจนเลือกไม่ได้เลย
  const selectedBranchDept =
    (lookup?.branches || []).find((b) => b.id === branchId)?.department_id || null;
  const matchingCashiers = (lookup?.cashiers || []).filter(
    (c) => selectedBranchDept && c.department_id === selectedBranchDept
  );
  const cashierOptions = matchingCashiers.length > 0 ? matchingCashiers : lookup?.cashiers || [];

  /**
   * แจ้งว่ายอดในระบบไม่ตรงกับที่เขียนหน้าซอง
   *
   * ทำไมต้องมีทางนี้: ถ้าไม่มี แมสเซนเจอร์จะเหลือแค่สองทาง — กดรับทั้งที่รู้ว่า
   * ไม่ตรง หรือไม่รับเลยแล้วเงินค้างที่สาขา ทางที่สามคือแจ้งไว้ในระบบทันที
   * ให้สองฝ่ายเคลียร์กันก่อนเงินออกจากสาขา
   */
  const reportMismatch = async (handover: any) => {
    const reason = window.prompt(
      `แจ้งยอดไม่ตรง — ซอง #${handover.handover_no}\n` +
        `ระบบแจ้งไว้ ${formatSatangToBaht(handover.declared_amount_satang)} บาท\n\n` +
        'ระบุยอดที่เขียนบนหน้าซองจริง และรายละเอียด (อย่างน้อย 5 ตัวอักษร):'
    );
    if (!reason || reason.trim().length < 5) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/cashier/handovers/${handover.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dispute', reason: reason.trim() }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'แจ้งไม่สำเร็จ');
      } else {
        setError('');
        setHandovers((prev) => prev.filter((h) => h.id !== handover.id));
        setHandoverId('');
        setFaceValueOk(false);
        setStep('แจ้งยอดไม่ตรงแล้ว — แคชเชียร์และฝ่ายบัญชีได้รับแจ้งเตือน กรุณาให้แคชเชียร์ออกซองใหม่');
      }
    } catch {
      setError('เชื่อมต่อไม่สำเร็จ');
    }
    setSaving(false);
  };

  const handleSubmit = async () => {
    if (!canSubmit || !photoFile) return;
    setSaving(true);
    setError('');

    // เขียน draft ก่อนแตะ network เสมอ — แอปถูก kill กลางทางยังกู้ได้
    saveDraft(draftKey, { cashierName, envelopeCount, amount });

    try {
      setStep('กำลังอัปโหลดรูปซองเงิน...');
      const photo = await uploadJobPhoto(jobId, photoFile, 'cash_envelope', geo, 'ซองเงินตอนรับมอบ');

      setStep('กำลังบันทึกการรับมอบ...');
      const res = await fetch(`/api/messenger/runs/${jobId}/pickup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          selectedHandover
            ? {
                handover_id: selectedHandover.id,
                face_value_confirmed: faceValueOk,
                envelope_photo_id: photo.id,
                lat: geo?.lat ?? null,
                lng: geo?.lng ?? null,
                gps_accuracy_m: geo?.accuracy ?? null,
              }
            : {
                branch_id: branchId,
                cashier_profile_id: cashierProfileId || null,
                cashier_name: cashierName.trim(),
                envelope_count: Number(envelopeCount),
                envelope_amount: amount,
                envelope_photo_id: photo.id,
                lat: geo?.lat ?? null,
                lng: geo?.lng ?? null,
                gps_accuracy_m: geo?.accuracy ?? null,
              }
        ),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'บันทึกไม่สำเร็จ');
        setSaving(false);
        setStep('');
        return;
      }
      clearDraft(draftKey);
      // กลับไปหน้าทริป เพื่อเลือกว่าจะเก็บสาขาถัดไป หรือไปฝากธนาคาร
      router.replace(`/messenger/${jobId}`);
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
        <div className="title-badge">📥 จุดรับซองเงิน</div>
        <h2>รับซองเงินจากแคชเชียร์{pickups.length > 0 ? ` · จุดที่ ${pickups.length + 1}` : ''}</h2>
        <div className="title-accent" />
      </div>

      <div className="scan-panel">
        {/* เส้นทางหลัก: รับซองที่แคชเชียร์ส่งไว้ในระบบแล้ว
            ยอดมาจากแคชเชียร์ แมสเซนเจอร์แก้ไม่ได้ (ฐานข้อมูลบังคับ) */}
        {handovers.length > 0 && (
          <div className="form-group">
            <label htmlFor="handover-select">ซองที่แคชเชียร์ส่งไว้ในระบบ</label>
            <select
              id="handover-select"
              value={handoverId}
              onChange={(e) => {
                setHandoverId(e.target.value);
                setFaceValueOk(false);
              }}
            >
              <option value="">-- ไม่มีในระบบ / คีย์ยอดเอง --</option>
              {handovers
                .filter((h) => !takenBranchIds.has(h.branch_id))
                .map((h) => (
                  <option key={h.id} value={h.id}>
                    #{h.handover_no} · {h.branch_name} · {formatSatangToBaht(h.declared_amount_satang)} บาท ·{' '}
                    {h.envelope_count} ซอง
                  </option>
                ))}
            </select>
          </div>
        )}

        {selectedHandover ? (
          <>
            <div
              style={{
                border: '2px solid var(--primary)',
                borderRadius: 'var(--radius-sm)',
                padding: '14px 16px',
                marginBottom: 16,
                background: 'var(--surface)',
              }}
            >
              <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                ยอดที่แคชเชียร์แจ้งไว้ — แก้ไม่ได้
              </div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                {formatSatangToBaht(selectedHandover.declared_amount_satang)} บาท
              </div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text)', marginTop: 2 }}>
                {selectedHandover.branch_name} · {selectedHandover.envelope_count} ซอง · แคชเชียร์{' '}
                {selectedHandover.declared_by_name || '—'}
              </div>
              {selectedHandover.note && (
                <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: 4 }}>
                  หมายเหตุ: {selectedHandover.note}
                </div>
              )}
            </div>

            {/* จุดที่สองฝ่ายยืนยันยอดเดียวกัน — ถ้าไม่ตรงต้องแจ้ง ไม่ใช่กดรับ */}
            <div
              className="form-group"
              style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}
            >
              <input
                type="checkbox"
                id="face-value-ok"
                checked={faceValueOk}
                onChange={(e) => setFaceValueOk(e.target.checked)}
                style={{ width: 24, height: 24, marginTop: 2, flexShrink: 0 }}
              />
              <label htmlFor="face-value-ok" style={{ margin: 0, color: 'var(--text)' }}>
                ยอดในระบบ <strong>ตรงกับที่เขียนบนหน้าซอง</strong> ที่ได้รับมา
              </label>
            </div>

            <button
              type="button"
              className="ghost-button"
              onClick={() => reportMismatch(selectedHandover)}
              style={{ minHeight: 48, width: '100%', marginBottom: 8 }}
            >
              ⚠️ ยอดไม่ตรงกับหน้าซอง — แจ้งไว้ในระบบ
            </button>
            <div style={{ fontSize: '0.82rem', color: 'var(--muted)', marginBottom: 12 }}>
              แจ้งตอนอยู่หน้าเคาน์เตอร์ ก่อนเงินออกจากสาขา — เป็นจุดเดียวที่ยังเคลียร์กันได้
              โดยไม่มีเงินเดินทาง
            </div>
          </>
        ) : (
          <>
            {/* สาขาเลือกที่จุดรับ ไม่ใช่ตอนเปิดทริป เพราะทริปหนึ่งเก็บได้หลายสาขา */}
            <div className="form-group">
              <label htmlFor="branch-select">สาขาที่รับซองเงิน *</label>
              <select id="branch-select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">-- เลือกสาขา --</option>
                {(lookup?.branches || []).map((b) => (
                  <option key={b.id} value={b.id} disabled={takenBranchIds.has(b.id)}>
                    {b.name}
                    {takenBranchIds.has(b.id) ? ' (เก็บแล้วในทริปนี้)' : ''}
                  </option>
                ))}
              </select>
            </div>

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
            {cashierOptions.map((c) => (
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
          <label htmlFor="amount">ยอดเงินตามหน้าซอง (บาท) *</label>
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

          </>
        )}

        <div className="form-group">
          <label>รูปซองเงิน *</label>
          <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: 8 }}>
            ถ่ายให้เห็นยอดที่เขียนบนหน้าซอง — ใบ Pay-in อยู่ในซอง ไม่ต้องแกะ
          </div>
          <label
            htmlFor="envelope-photo"
            className="ghost-button"
            style={{ display: 'inline-flex', minHeight: 64, fontSize: '1.05rem', cursor: 'pointer', width: '100%', justifyContent: 'center' }}
          >
            📷 {photoFile ? 'ถ่ายใหม่' : 'ถ่ายรูปซองเงิน'}
          </label>
          <input
            id="envelope-photo"
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
                alt="ตัวอย่างรูปซองเงิน"
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
            : selectedHandover
              ? `✅ รับซอง ${formatSatangToBaht(selectedHandover.declared_amount_satang)} บาท`
              : amountOk
                ? `✅ ยืนยันรับมอบ ${formatBahtDisplay(amount)} บาท`
                : '✅ ยืนยันรับมอบ'}
        </button>
        <Link href={`/messenger/${jobId}`} className="ghost-button" style={{ justifyContent: 'center' }}>
          กลับไปหน้าทริป
        </Link>
      </div>

      {showFullPreview && photoPreview && (
        <div className="scan-popup-overlay" onClick={() => setShowFullPreview(false)}>
          <div className="scan-popup-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="scan-popup-handle" />
            <img src={photoPreview} alt="รูปซองเงินเต็มจอ" style={{ width: '100%', borderRadius: 'var(--radius-sm)' }} />
            <button type="button" className="scan-popup-close" onClick={() => setShowFullPreview(false)}>
              ปิด
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
