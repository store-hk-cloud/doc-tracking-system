'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type Branch = { id: string; name: string; code: string };

// START ของ flow: เลือกสาขาที่จะไปรับเงิน
export default function NewCashRunPage() {
  const router = useRouter();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
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
    if (!branchId) {
      setError('กรุณาเลือกสาขา');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/messenger/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch_id: branchId, note: note || null }),
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
        <h2>เลือกสาขาที่จะไปรับเงิน</h2>
        <div className="title-accent" />
      </div>

      <div className="scan-panel">
        <div className="form-group">
          <label htmlFor="branch">สาขา *</label>
          <select id="branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">-- เลือกสาขา --</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </select>
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
          disabled={saving || !branchId}
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
