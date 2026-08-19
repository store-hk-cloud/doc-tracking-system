'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatSatangToBaht } from '@/lib/money';
import { VARIANCE_CAUSE_LABELS, VARIANCE_REPORT_STATUS_LABELS, type VarianceCauseCode, type VarianceReportStatus } from '@/types';

type Row = {
  id: string;
  job_id: string;
  job_no: number | null;
  branch_name: string | null;
  variance_kind: 'short' | 'over';
  variance_satang_snapshot: number;
  cause_code: VarianceCauseCode;
  cause_detail: string;
  reported_at: string;
  reported_by_name: string | null;
  status: VarianceReportStatus;
  deposit: { bank_name: string | null; slip_status: string; actual_amount_satang: number };
};

const ageInHours = (iso: string) => (Date.now() - new Date(iso).getTime()) / 3_600_000;

export default function VarianceQueuePage() {
  const [tab, setTab] = useState<'pending_review' | 'all'>('pending_review');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/messenger/variances?status=${tab}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setRows(d.data);
        else setError(d.error || 'โหลดข้อมูลไม่สำเร็จ');
        setLoading(false);
      })
      .catch(() => {
        setError('เชื่อมต่อไม่สำเร็จ');
        setLoading(false);
      });
  }, [tab]);

  const pending = rows.filter((r) => r.status === 'pending_review');
  const oldest = pending.length > 0 ? Math.max(...pending.map((r) => ageInHours(r.reported_at))) : 0;

  return (
    <div>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="title-badge">🚨 ตรวจยอด</div>
        <h2>รายการยอดขาด/เกินที่รอตรวจสอบ</h2>
        <div className="title-accent" />
      </div>

      <div className="scan-panel">
        <div className="segmented-control" style={{ marginBottom: 14 }}>
          <button type="button" className={tab === 'pending_review' ? 'active' : ''} onClick={() => setTab('pending_review')}>
            รอตรวจสอบ
          </button>
          <button type="button" className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
            ทั้งหมด
          </button>
        </div>

        {/* ทำให้ "ปล่อยค้างเงียบ ๆ" มีต้นทุนที่มองเห็นได้ */}
        {oldest >= 24 && (
          <div className="toast error" style={{ position: 'static', marginBottom: 12 }}>
            มีรายการค้างนานสุด {Math.floor(oldest / 24)} วัน — ควรตรวจสอบโดยเร็ว
          </div>
        )}

        {error && (
          <div className="toast error" style={{ position: 'static', marginBottom: 12 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="empty-search">กำลังโหลด...</div>
        ) : rows.length === 0 ? (
          <div className="empty-search">ไม่มีรายการที่รอตรวจสอบ</div>
        ) : (
          rows.map((row) => {
            const isOver = row.variance_kind === 'over';
            return (
              <Link
                key={row.id}
                href={`/finance/variances/${row.id}`}
                className={`job-card ${isOver ? 'locked' : 'warn'}`}
              >
                <div className="job-card-head">
                  <span className="code-cell">#{row.job_no ?? '—'}</span>
                  <span className={`status-badge ${isOver ? 'locked' : 'holding'}`}>
                    {isOver ? '🚨 เงินเกิน' : '⚠️ เงินขาด'}
                  </span>
                </div>

                <div className="job-card-amount">
                  {formatSatangToBaht(Math.abs(row.variance_satang_snapshot))} บาท
                </div>

                <div className="job-card-meta">
                  {row.branch_name || 'ไม่ระบุสาขา'} · {row.deposit?.bank_name || 'ไม่ระบุธนาคาร'} ·{' '}
                  {row.reported_by_name || 'ไม่ระบุผู้รายงาน'}
                </div>
                <div className="job-card-meta">
                  {VARIANCE_CAUSE_LABELS[row.cause_code]} ·{' '}
                  {new Date(row.reported_at).toLocaleString('th-TH', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {' · '}
                  {VARIANCE_REPORT_STATUS_LABELS[row.status]}
                </div>

                {row.deposit?.slip_status === 'pending' && (
                  <div className="status-badge awaiting" style={{ marginTop: 6 }}>
                    ยังไม่แนบสลิป — อนุมัติไม่ได้
                  </div>
                )}
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
