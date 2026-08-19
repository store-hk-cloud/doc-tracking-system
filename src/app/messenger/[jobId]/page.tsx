'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatSatangToBaht } from '@/lib/money';
import { MESSENGER_JOB_STATUS_COLORS, MESSENGER_JOB_STATUS_LABELS, type MessengerJobStatus } from '@/types';

/**
 * หน้าทริป — ศูนย์กลางของงานเก็บเงินหนึ่งรอบ
 *
 * งานจริงคือเก็บซองจากหลายสาขาในทริปเดียวแล้วนำฝากรวมครั้งเดียว หน้านี้จึงเป็น
 * ที่ที่แมสเซนเจอร์เห็นว่าเก็บมาแล้วกี่จุด รวมเป็นเงินเท่าไร และเลือกได้สองทาง:
 * เก็บสาขาถัดไป หรือไปฝากธนาคาร
 *
 * ปุ่ม "ไปฝากธนาคาร" ตั้งใจไม่ให้กดได้จนกว่าจะมีจุดรับอย่างน้อยหนึ่งจุด เพราะ
 * trigger assert_expected_matches_pickups ปฏิเสธการฝากที่ไม่มีซองอยู่แล้ว
 * กันไว้ที่หน้าจอด้วยเพื่อไม่ให้ผู้ใช้เจอ error ที่อ่านไม่รู้เรื่อง
 */
export default function RunDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const router = useRouter();

  const [job, setJob] = useState<any>(null);
  const [pickups, setPickups] = useState<any[]>([]);
  const [deposit, setDeposit] = useState<any>(null);
  const [expectedTotal, setExpectedTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/messenger/runs/${jobId}`);
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'ไม่พบทริปนี้');
      } else {
        setJob(data.data.job);
        setPickups(data.data.pickups || []);
        setDeposit(data.data.deposit || null);
        setExpectedTotal(data.data.expected_total_satang || 0);
        // ฝากไปแล้ว — ผลเทียบยอดคือสิ่งที่ต้องเห็น ไม่ใช่หน้ารวบรวมซอง
        if (data.data.deposit) router.replace(`/messenger/${jobId}/result`);
      }
    } catch {
      setError('เชื่อมต่อไม่สำเร็จ');
    }
    setLoading(false);
  }, [jobId, router]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className="loading-screen">Loading...</div>;

  if (error) {
    return (
      <div>
        <div className="toast error" style={{ position: 'static' }}>{error}</div>
        <Link href="/messenger" className="ghost-button" style={{ marginTop: 12, justifyContent: 'center' }}>
          กลับไปคิวงาน
        </Link>
      </div>
    );
  }

  const status = job?.status as MessengerJobStatus;
  const canCollect = status === 'open' || status === 'picked_up';

  return (
    <div>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="title-badge">🏍 ทริปเก็บเงิน #{job?.job_no}</div>
        <h2>ซองเงินที่เก็บมาแล้ว</h2>
        <div className="title-accent" />
      </div>

      <div className="scan-panel" style={{ marginBottom: 16 }}>
        <div className="metric-row">
          <div>
            <span className="metric-label">จุดรับที่เก็บแล้ว</span>
            <strong className="metric-value">{pickups.length} สาขา</strong>
          </div>
          <div>
            <span className="metric-label">จำนวนซองรวม</span>
            <strong className="metric-value">
              {pickups.reduce((s, p) => s + Number(p.envelope_count), 0)} ซอง
            </strong>
          </div>
          <div>
            <span className="metric-label">ยอดรวมตามหน้าซอง</span>
            <strong className="metric-value">{formatSatangToBaht(expectedTotal)} บาท</strong>
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <span className={`status-badge ${MESSENGER_JOB_STATUS_COLORS[status] || ''}`}>
            {MESSENGER_JOB_STATUS_LABELS[status] || status}
          </span>
        </div>
      </div>

      {pickups.length === 0 ? (
        <div className="empty-search" style={{ marginBottom: 16 }}>
          ยังไม่ได้เก็บซองเงินจากสาขาใด กดปุ่มด้านล่างเพื่อเริ่มที่สาขาแรก
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {pickups.map((p, i) => (
            <div key={p.id} className="job-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>จุดที่ {i + 1}</span>
                  <div style={{ fontWeight: 700 }}>{p.branch_name || 'ไม่ทราบสาขา'}</div>
                </div>
                <strong style={{ fontSize: '1.1rem', fontVariantNumeric: 'tabular-nums' }}>
                  {formatSatangToBaht(p.envelope_amount_satang)} บาท
                </strong>
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: 4 }}>
                {p.envelope_count} ซอง · แคชเชียร์ {p.cashier_name}
              </div>
              {p.envelope_photo_link && (
                <a
                  href={p.envelope_photo_link}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: '0.85rem' }}
                >
                  🖼 ดูรูปซอง
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="job-action-bar">
        {canCollect && (
          <Link
            href={`/messenger/${jobId}/pickup`}
            className={pickups.length === 0 ? 'secondary-button' : 'ghost-button'}
            style={{ justifyContent: 'center' }}
          >
            {pickups.length === 0 ? '📥 รับซองเงินจุดแรก' : '➕ เก็บสาขาถัดไป'}
          </Link>
        )}
        {canCollect && pickups.length > 0 && (
          <Link href={`/messenger/${jobId}/deposit`} className="secondary-button" style={{ justifyContent: 'center' }}>
            🏦 ไปฝากธนาคาร ({formatSatangToBaht(expectedTotal)} บาท)
          </Link>
        )}
        {deposit && (
          <Link href={`/messenger/${jobId}/result`} className="secondary-button" style={{ justifyContent: 'center' }}>
            📄 ดูผลเทียบยอด
          </Link>
        )}
        <Link href="/messenger" className="ghost-button" style={{ justifyContent: 'center' }}>
          กลับไปคิวงาน
        </Link>
      </div>
    </div>
  );
}
