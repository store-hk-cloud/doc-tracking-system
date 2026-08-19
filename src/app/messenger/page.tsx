'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatSatangToBaht } from '@/lib/money';
import { MESSENGER_JOB_STATUS_COLORS, MESSENGER_JOB_STATUS_LABELS, type MessengerJobStatus } from '@/types';

type Row = {
  id: string;
  job_no: number;
  status: MessengerJobStatus;
  branch_name: string | null;
  created_at: string;
  payin_amount_satang: number | null;
  envelope_count: number | null;
  actual_amount_satang: number | null;
  variance_satang: number | null;
  slip_status: 'pending' | 'attached' | null;
};

const OPEN_STATUSES: MessengerJobStatus[] = ['open', 'picked_up', 'deposited', 'pending_review'];

// ขั้นถัดไปของแต่ละสถานะ — ปุ่มเดียวต่อการ์ด ไม่ให้ผู้ใช้ต้องเดาว่าจะกดอะไร
function nextStep(row: Row): { href: string; label: string } | null {
  switch (row.status) {
    case 'open':
      return { href: `/messenger/${row.id}/pickup`, label: '📥 รับเงินจากแคชเชียร์' };
    case 'picked_up':
      return { href: `/messenger/${row.id}/deposit`, label: '🏦 บันทึกการนำฝาก' };
    case 'deposited':
      return { href: `/messenger/${row.id}/result`, label: '📄 ดูผลเทียบยอด' };
    case 'pending_review':
      return { href: `/messenger/${row.id}/result`, label: '🔒 ดูรายการที่ถูกล็อก' };
    default:
      return null;
  }
}

export default function MessengerQueuePage() {
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      const statuses = tab === 'open' ? OPEN_STATUSES : (['completed', 'closed', 'cancelled'] as const);
      statuses.forEach((s) => params.append('status', s));
      const res = await fetch(`/api/messenger/runs?${params.toString()}`);
      const data = await res.json();
      if (data.success) setRows(data.data);
      else setError(data.error || 'โหลดข้อมูลไม่สำเร็จ');
    } catch {
      setError('เชื่อมต่อไม่สำเร็จ กรุณาลองอีกครั้ง');
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="title-badge">🏍 งานฝากเงิน</div>
        <h2>งานฝากเงินของฉัน</h2>
        <div className="title-accent" />
      </div>

      <div className="scan-panel">
        <div className="segmented-control" style={{ marginBottom: 14 }}>
          <button type="button" className={tab === 'open' ? 'active' : ''} onClick={() => setTab('open')}>
            กำลังดำเนินการ
          </button>
          <button type="button" className={tab === 'done' ? 'active' : ''} onClick={() => setTab('done')}>
            ปิดงานแล้ว
          </button>
        </div>

        {error && (
          <div className="toast error" style={{ position: 'static', marginBottom: 12 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="empty-search">กำลังโหลด...</div>
        ) : rows.length === 0 ? (
          <div className="empty-search">
            {tab === 'open' ? 'ไม่มีงานที่กำลังดำเนินการ' : 'ยังไม่มีงานที่ปิดแล้ว'}
          </div>
        ) : (
          rows.map((row) => {
            const step = nextStep(row);
            const variance = row.variance_satang;
            const locked = row.status === 'pending_review' && variance !== null && variance > 0;
            const warn = row.status === 'pending_review' && variance !== null && variance < 0;
            return (
              <div key={row.id} className={`job-card ${locked ? 'locked' : warn ? 'warn' : ''}`}>
                <div className="job-card-head">
                  <span className="code-cell">#{row.job_no}</span>
                  <span className={MESSENGER_JOB_STATUS_COLORS[row.status]}>
                    {locked ? 'ล็อก — รออนุมัติ' : MESSENGER_JOB_STATUS_LABELS[row.status]}
                  </span>
                </div>

                <div className="job-card-amount">
                  {row.payin_amount_satang !== null
                    ? `${formatSatangToBaht(row.payin_amount_satang)} บาท`
                    : 'ยังไม่ได้รับเงิน'}
                </div>

                <div className="job-card-meta">
                  {row.branch_name || 'ไม่ระบุสาขา'}
                  {row.envelope_count ? ` · ${row.envelope_count} ซอง` : ''}
                  {' · '}
                  {new Date(row.created_at).toLocaleString('th-TH', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>

                {variance !== null && variance !== 0 && (
                  <div
                    className="job-card-meta"
                    style={{ color: 'var(--text)', fontWeight: 700, marginTop: 4 }}
                  >
                    {variance > 0 ? 'ยอดเกิน' : 'ยอดขาด'} {formatSatangToBaht(Math.abs(variance))} บาท
                  </div>
                )}

                {row.slip_status === 'pending' && (
                  <div className="status-badge awaiting" style={{ marginTop: 6 }}>
                    รอแนบสลิป
                  </div>
                )}

                {step && (
                  <Link
                    href={step.href}
                    className="secondary-button"
                    style={{ marginTop: 12, width: '100%', minHeight: 52, justifyContent: 'center' }}
                  >
                    {step.label}
                  </Link>
                )}
              </div>
            );
          })
        )}
      </div>

      {tab === 'open' && (
        <div className="job-action-bar">
          <Link href="/messenger/new" className="secondary-button" style={{ justifyContent: 'center' }}>
            ➕ เริ่มงานใหม่ (เลือกสาขา)
          </Link>
        </div>
      )}
    </div>
  );
}
