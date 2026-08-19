'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthProvider';
import { canApproveOverage, canCloseShortage } from '@/lib/capabilities';
import { formatSatangToBaht } from '@/lib/money';
import { VARIANCE_CAUSE_LABELS, VARIANCE_REPORT_STATUS_LABELS, type VarianceCauseCode } from '@/types';

/**
 * หน้าอนุมัติ + audit view
 *
 * กฎ UI: ไม่มีปุ่มแก้หรือลบใน audit view เลย รวมถึง super_admin
 * ข้อมูลเงินไม่ควรมีปุ่มลบใน UI (ต่างจากหน้า /tracking ที่ super_admin ลบเอกสารได้)
 */
export default function VarianceReviewPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const router = useRouter();
  const { profile } = useAuth();

  const [row, setRow] = useState<any>(null);
  const [run, setRun] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [reason, setReason] = useState('');
  const [slipChecked, setSlipChecked] = useState(false);

  const load = async () => {
    try {
      const res = await fetch('/api/messenger/variances?status=all');
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'โหลดข้อมูลไม่สำเร็จ');
        setLoading(false);
        return;
      }
      const found = json.data.find((r: any) => r.id === reportId);
      if (!found) {
        setError('ไม่พบรายงานนี้');
        setLoading(false);
        return;
      }
      setRow(found);
      const runRes = await fetch(`/api/messenger/runs/${found.job_id}`);
      const runJson = await runRes.json();
      if (runJson.success) setRun(runJson.data);
    } catch {
      setError('เชื่อมต่อไม่สำเร็จ');
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  if (loading) return <div className="loading-screen">Loading...</div>;
  if (error || !row) {
    return (
      <div className="scan-panel">
        <div className="toast error" style={{ position: 'static' }}>{error || 'ไม่พบข้อมูล'}</div>
      </div>
    );
  }

  const isOver = row.variance_kind === 'over';
  const deposit = run?.deposit || row.deposit;
  const pending = row.status === 'pending_review';
  const slipMissing = !deposit?.slip_photo_id;

  // สิทธิ์ตัดสิน: เงินเกินเข้มกว่าเงินขาด (server บังคับซ้ำอีก 3 ชั้น)
  const mayDecide = isOver ? canApproveOverage(profile) : canCloseShortage(profile);

  // แยกหน้าที่: ผู้ที่เกี่ยวข้องกับเงินก้อนนี้ตัดสินเองไม่ได้
  // ทริปหนึ่งมีได้หลายจุดรับ ต้องรวมผู้รับและแคชเชียร์ของทุกจุด ไม่ใช่จุดแรกจุดเดียว
  // (trigger assert_variance_approver ตรวจซ้ำที่ DB — นี่แค่ทำให้ปุ่มไม่หลอกตา)
  const runPickups: any[] = run?.pickups || [];
  const conflicted =
    !!profile &&
    [
      deposit?.submitted_by,
      row.reported_by,
      ...runPickups.map((p) => p.received_by),
      ...runPickups.map((p) => p.cashier_profile_id),
    ]
      .filter(Boolean)
      .includes(profile.id);

  const canSubmit = pending && mayDecide && !conflicted && !slipMissing && reason.trim().length >= 10 && slipChecked && !saving;

  const decide = async (decision: 'approved' | 'rejected' | 'returned') => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/messenger/variances/${reportId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, reason: reason.trim(), slip_checked: true }),
      });
      const json = await res.json();
      if (!json.success) setError(json.error || 'บันทึกไม่สำเร็จ');
      else router.replace('/finance/variances');
    } catch {
      setError('เชื่อมต่อไม่สำเร็จ');
    }
    setSaving(false);
  };

  return (
    <div>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="title-badge">{isOver ? '🚨 เงินเกิน' : '⚠️ เงินขาด'}</div>
        <h2>ตรวจสอบผลต่าง · งาน #{row.job_no ?? '—'}</h2>
        <div className="title-accent" />
      </div>

      <div className="scan-panel">
        <div className={`variance-box ${isOver ? 'over' : 'short'}`}>
          <span className="variance-icon">{isOver ? '🚨' : '⚠️'}</span>
          <span className="variance-headline">
            {isOver ? 'ยอดเกิน' : 'ยอดขาด'} {formatSatangToBaht(Math.abs(row.variance_satang_snapshot))} บาท
          </span>
          <div className="variance-rows">
            <div className="variance-row">
              <span>ยอดที่ต้องฝาก</span>
              <span>{formatSatangToBaht(deposit?.expected_total_satang ?? 0)}</span>
            </div>
            <div className="variance-row">
              <span>ยอดที่ฝากจริง</span>
              <span>{formatSatangToBaht(deposit?.actual_amount_satang ?? 0)}</span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 14, fontSize: '0.92rem', color: 'var(--text)' }}>
          <div className="variance-row">
            <span>สาขา</span>
            <span>{row.branch_name || '—'}</span>
          </div>
          <div className="variance-row">
            <span>ธนาคาร</span>
            <span>{deposit?.bank_name || '—'} · {deposit?.bank_branch_name || '—'}</span>
          </div>
          <div className="variance-row">
            <span>เลขที่ใบนำฝาก</span>
            <span className="code-cell">{deposit?.reference_no || '—'}</span>
          </div>
          <div className="variance-row">
            <span>ผู้ฝาก</span>
            <span>{deposit?.submitted_signature || '—'}</span>
          </div>
          {/* แจกแจงทุกจุดรับของทริป การเงินต้องเห็นว่าเงินก้อนนี้มาจากสาขาใดบ้าง
              ไม่ใช่แค่ยอดรวม เพราะถ้ายอดไม่ตรงต้องรู้ว่าจะไปถามที่ไหน */}
          {runPickups.map((p, i) => (
            <div className="variance-row" key={p.id}>
              <span>
                จุดรับที่ {i + 1} · {p.branch_name || 'ไม่ทราบสาขา'}
              </span>
              <span>
                {formatSatangToBaht(p.envelope_amount_satang)} บาท · {p.envelope_count} ซอง ·
                แคชเชียร์ {p.cashier_name}
              </span>
            </div>
          ))}
          <div className="variance-row">
            <span>สถานะรายงาน</span>
            <span>{VARIANCE_REPORT_STATUS_LABELS[row.status as keyof typeof VARIANCE_REPORT_STATUS_LABELS]}</span>
          </div>
        </div>

        <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <strong>คำชี้แจงของแมสเซนเจอร์</strong>
          <div style={{ marginTop: 4 }}>
            {VARIANCE_CAUSE_LABELS[row.cause_code as VarianceCauseCode]} — {row.cause_detail}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: 4 }}>
            {row.reported_by_name} · {new Date(row.reported_at).toLocaleString('th-TH')}
          </div>
        </div>

        {/* วางรูปสลิปติดกับตัวเลข ให้เทียบด้วยตาได้ทันที */}
        <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <strong>หลักฐานภาพ</strong>
          {slipMissing && (
            <div className="toast error" style={{ position: 'static', marginTop: 8 }}>
              ยังไม่มีรูปใบนำฝาก — อนุมัติไม่ได้จนกว่าแมสเซนเจอร์จะแนบรูป
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
            {(run?.photos || []).map((p: any) => (
              <a
                key={p.id}
                href={p.view_link}
                target="_blank"
                rel="noopener noreferrer"
                className="ghost-button"
                style={{ minHeight: 44 }}
              >
                {p.photo_kind === 'deposit_slip'
                  ? '🧾 ใบนำฝาก'
                  : p.photo_kind === 'cash_envelope'
                    ? '💰 ซองเงิน'
                    : p.photo_kind === 'payin_slip'
                      ? '📄 ใบ Pay-in'
                      : p.photo_kind === 'variance_doc'
                        ? '📎 เอกสารประกอบ'
                        : '🖼 รูปอื่น'}
              </a>
            ))}
          </div>
        </div>

        {/* ── ฟอร์มตัดสิน ── */}
        {pending && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            {!mayDecide && (
              <div className="toast error" style={{ position: 'static', marginBottom: 10 }}>
                {isOver
                  ? 'เฉพาะผู้ดูแลระบบ หรือธุรการในแผนกการเงิน (FIN) เท่านั้นที่อนุมัติยอดเกินได้'
                  : 'เฉพาะผู้ดูแลระบบ หรือเจ้าหน้าที่แผนกการเงิน (FIN) เท่านั้นที่ปิดยอดขาดได้'}
              </div>
            )}
            {conflicted && (
              <div className="toast error" style={{ position: 'static', marginBottom: 10 }}>
                คุณเกี่ยวข้องกับเงินก้อนนี้ จึงไม่สามารถเป็นผู้อนุมัติได้
              </div>
            )}

            {mayDecide && !conflicted && (
              <>
                <div className="form-group">
                  <label htmlFor="reason">เหตุผลการตัดสิน * (อย่างน้อย 10 ตัวอักษร)</label>
                  <textarea
                    id="reason"
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="ระบุสิ่งที่ตรวจสอบและข้อสรุป"
                  />
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                    {reason.trim().length}/10
                  </div>
                </div>

                <label
                  htmlFor="slip-checked"
                  style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44, cursor: 'pointer' }}
                >
                  <input
                    id="slip-checked"
                    type="checkbox"
                    checked={slipChecked}
                    onChange={(e) => setSlipChecked(e.target.checked)}
                    style={{ width: 20, height: 20 }}
                  />
                  <span>ข้าพเจ้าได้เปิดรูปใบนำฝากเทียบกับยอดที่บันทึกแล้ว</span>
                </label>

                <div className="form-group" style={{ marginTop: 10 }}>
                  <label htmlFor="signer">ผู้ตัดสิน</label>
                  <input id="signer" type="text" value={profile?.full_name || ''} readOnly />
                </div>
              </>
            )}
          </div>
        )}

        {/* ── audit trail ── */}
        {run?.audit && run.audit.length > 0 && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <strong>ประวัติทั้งหมดของงานนี้</strong>
            <div className="audit-list" style={{ marginTop: 8 }}>
              {run.audit.map((a: any) => (
                <div key={a.id} className="audit-row">
                  <span className="audit-when">{new Date(a.created_at).toLocaleString('th-TH')}</span>
                  <span className="audit-who">
                    {a.actor_signature} ({a.actor_dept_code || a.actor_role})
                  </span>
                  <span>
                    {a.action}
                    {a.from_status || a.to_status ? ` · ${a.from_status ?? '—'} → ${a.to_status ?? '—'}` : ''}
                    {a.amount_satang != null ? ` · ${formatSatangToBaht(a.amount_satang)} บาท` : ''}
                    {a.variance_satang != null && a.variance_satang !== 0
                      ? ` · ผลต่าง ${formatSatangToBaht(a.variance_satang)}`
                      : ''}
                  </span>
                  {a.reason && <span style={{ color: 'var(--muted)' }}>{a.reason}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="toast error" style={{ position: 'static', marginTop: 12 }}>
            {error}
          </div>
        )}
      </div>

      <div className="job-action-bar">
        {pending && mayDecide && !conflicted && (
          <>
            <button type="button" className="secondary-button" onClick={() => decide('approved')} disabled={!canSubmit}>
              {saving ? 'กำลังบันทึก...' : '✅ อนุมัติและปิดงาน'}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => decide('returned')}
              disabled={saving || reason.trim().length < 10 || !slipChecked}
              style={{ justifyContent: 'center' }}
            >
              ↩️ ตีกลับให้แก้รายงาน
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => decide('rejected')}
              disabled={saving || reason.trim().length < 10 || !slipChecked}
              style={{ justifyContent: 'center' }}
            >
              ❌ ไม่อนุมัติ (ปิดงานพร้อมบันทึกข้อโต้แย้ง)
            </button>
          </>
        )}
        <Link href="/finance/variances" className="ghost-button" style={{ justifyContent: 'center' }}>
          กลับไปคิวตรวจสอบ
        </Link>
      </div>
    </div>
  );
}
