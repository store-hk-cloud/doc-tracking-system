'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type Branch = { id: string; name: string; code: string };

/**
 * เปิดทริปใหม่
 *
 * ไม่เลือกสาขาที่นี่แล้ว เพราะทริปหนึ่งเก็บซองได้หลายสาขา สาขาถูกเลือกตอน
 * บันทึกแต่ละจุดรับ หน้านี้แสดงรายชื่อสาขาที่เก็บได้ไว้ให้ดูเป็นข้อมูลเท่านั้น
 */
export default function NewCashRunPage() {
  const router = useRouter();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/messenger/lookups')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setBranches(d.data.branches);
        else setError(d.error || 'โหลดรายชื่อสาขาไม่สำเร็จ');
      })
      .catch(() => setError('เชื่อมต่อไม่สำเร็จ'));
  }, []);

  const handleStart = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/messenger/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note || null }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'เริ่มงานไม่สำเร็จ');
        setSaving(false);
        return;
      }
      router.replace(`/messenger/${data.data.id}/pickup`);
    } catch {
      setError('เชื่อมต่อไม่สำเร็จ กรุณาลองอีกครั้ง');
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="title-badge">🏍 เริ่มงาน</div>
        <h2>เปิดทริปเก็บเงิน</h2>
        <div className="title-accent" />
      </div>

      <div className="scan-panel">
        <div className="form-group">
          <span className="form-label-static">จุดรับซองเงิน</span>
          <div
            style={{
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 12px',
              background: 'var(--surface-soft)',
              fontSize: '0.9rem',
              color: 'var(--muted)',
            }}
          >
            เลือกสาขาตอนรับซองแต่ละจุด — ทริปนี้เก็บได้หลายสาขาแล้วฝากรวมครั้งเดียว
            <div style={{ color: 'var(--text)', marginTop: 6 }}>
              สาขาที่เปิดรับอยู่ {branches.length} แห่ง
            </div>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="note">หมายเหตุ (ถ้ามี)</label>
          <textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        {error && (
          <div className="toast error" style={{ position: 'static', marginTop: 8 }}>
            {error}
          </div>
        )}
      </div>

      <div className="job-action-bar">
        <button
          type="button"
          className="secondary-button"
          onClick={handleStart}
          disabled={saving}
        >
          {saving ? 'กำลังเริ่มงาน...' : '➡️ ไปหน้ารับเงินจากแคชเชียร์'}
        </button>
        <Link href="/messenger" className="ghost-button" style={{ justifyContent: 'center' }}>
          ยกเลิก
        </Link>
      </div>
    </div>
  );
}
