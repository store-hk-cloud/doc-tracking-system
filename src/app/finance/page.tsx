'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatSatangToBaht } from '@/lib/money';
import type { CashDailySummary } from '@/types';

const todayStr = () => new Date().toISOString().split('T')[0];

// รายงานสรุปยอดผ่านประจำวัน + ตัวชี้วัดที่ฝ่ายการเงินต้องเห็นทุกเย็น
export default function FinanceOverviewPage() {
  const [date, setDate] = useState(todayStr());
  const [summary, setSummary] = useState<CashDailySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/messenger/reports/daily?date=${date}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setSummary(d.data);
        else setError(d.error || 'โหลดรายงานไม่สำเร็จ');
        setLoading(false);
      })
      .catch(() => {
        setError('เชื่อมต่อไม่สำเร็จ');
        setLoading(false);
      });
  }, [date]);

  return (
    <div>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="title-badge">💵 เงินสด</div>
        <h2>สรุปยอดผ่านประจำวัน</h2>
        <div className="title-accent" />
      </div>

      <div className="scan-panel">
        <div className="form-group" style={{ maxWidth: 240 }}>
          <label htmlFor="date">วันที่</label>
          <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {error && (
          <div className="toast error" style={{ position: 'static', marginBottom: 12 }}>
            {error}
          </div>
        )}

        <div className="metric-row">
          {loading || !summary ? (
            Array(4)
              .fill(0)
              .map((_, i) => (
                <div key={i}>
                  <span>กำลังโหลด...</span>
                  <strong>—</strong>
                </div>
              ))
          ) : (
            <>
              <div>
                <span>📥 รับเงินวันนี้</span>
                <strong>{formatSatangToBaht(summary.received_satang)}</strong>
              </div>
              <div>
                <span>🏦 ฝากวันนี้</span>
                <strong>{formatSatangToBaht(summary.deposited_satang)}</strong>
              </div>
              {/* ตัวเลขที่สำคัญที่สุด: คืนนี้ใครถือเงินอยู่บ้าง */}
              <div>
                <span>👛 เงินคงค้างในมือ</span>
                <strong>{formatSatangToBaht(summary.in_hand_satang)}</strong>
              </div>
              <div>
                <span>🚨 รอตรวจสอบ</span>
                <strong>{summary.pending_review_count}</strong>
              </div>
            </>
          )}
        </div>

        {summary && !loading && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <div className="variance-row">
              <span>ยอดขาดรวมวันนี้</span>
              <span style={{ fontWeight: 700 }}>{formatSatangToBaht(summary.short_satang)} บาท</span>
            </div>
            <div className="variance-row">
              <span>ยอดเกินรวมวันนี้</span>
              <span style={{ fontWeight: 700 }}>{formatSatangToBaht(summary.over_satang)} บาท</span>
            </div>
            <div className="variance-row">
              <span>รายการที่ยังไม่แนบสลิป</span>
              <span style={{ fontWeight: 700 }}>{summary.awaiting_slip_count}</span>
            </div>
            <div className="variance-row">
              <span>รายการที่สาขายังไม่ยืนยันยอด</span>
              <span style={{ fontWeight: 700 }}>{summary.awaiting_branch_confirm_count}</span>
            </div>
            <div className="variance-row">
              <span>จำนวนงานรับเงินวันนี้</span>
              <span style={{ fontWeight: 700 }}>{summary.job_count}</span>
            </div>
          </div>
        )}
      </div>

      <div className="job-action-bar">
        <Link href="/finance/variances" className="secondary-button" style={{ justifyContent: 'center' }}>
          🚨 ไปคิวตรวจยอดขาด/เกิน
          {summary && summary.pending_review_count > 0 ? ` (${summary.pending_review_count})` : ''}
        </Link>
      </div>
    </div>
  );
}
