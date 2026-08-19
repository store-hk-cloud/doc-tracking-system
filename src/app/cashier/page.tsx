'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { isCashier } from '@/lib/capabilities';
import { formatSatangToBaht } from '@/lib/money';
import { amountsMatch, formatBahtDisplay } from '@/lib/field-capture';

/**
 * หน้าแคชเชียร์ — ส่งซองเงินให้แมสเซนเจอร์
 *
 * แคชเชียร์เป็นเจ้าของยอดต้นทาง: เขียนใบ Pay-in ใส่เงิน ปิดผนึกซอง เขียนยอดหน้าซอง
 * แล้วมาประกาศยอดนั้นที่นี่ แมสเซนเจอร์จะเห็นในคิว มารับแล้วกดยืนยันว่ายอดตรง
 *
 * ยอดที่ส่งแล้ว **แก้ไม่ได้** ต้องยกเลิกแล้วออกใบใหม่ จึงบังคับพิมพ์ยอดสองครั้ง
 * ให้ตรงกันก่อนส่ง เหมือนหน้าจอฝั่งแมสเซนเจอร์
 */

const STATUS_LABEL: Record<string, string> = {
  pending: 'รอแมสเซนเจอร์มารับ',
  accepted: 'แมสเซนเจอร์รับแล้ว',
  disputed: 'ยอดไม่ตรง — ต้องออกใบใหม่',
  cancelled: 'ยกเลิกแล้ว',
};

const STATUS_CLASS: Record<string, string> = {
  pending: 'warn',
  accepted: 'success',
  disputed: 'error',
  cancelled: '',
};

export default function CashierPage() {
  const { profile } = useAuth();
  const canDeclare = isCashier(profile) || profile?.role === 'super_admin';

  const [rows, setRows] = useState<any[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [myBranchIds, setMyBranchIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const [branchId, setBranchId] = useState('');
  const [amount, setAmount] = useState('');
  const [amountConfirm, setAmountConfirm] = useState('');
  const [envelopeCount, setEnvelopeCount] = useState('1');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const [listRes, lookupRes] = await Promise.all([
        fetch('/api/cashier/handovers').then((r) => r.json()),
        fetch('/api/messenger/lookups').then((r) => r.json()),
      ]);
      if (listRes.success) {
        setRows(listRes.data);
        const mine: string[] = listRes.meta?.my_branch_ids || [];
        setMyBranchIds(mine);
        if (mine.length === 1) setBranchId((prev) => prev || mine[0]);
      } else {
        setMessage(`❌ ${listRes.error}`);
      }
      if (lookupRes.success) setBranches(lookupRes.data.branches);
    } catch {
      setMessage('❌ เชื่อมต่อไม่สำเร็จ');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const amountOk = amountsMatch(amount, amountConfirm);
  const selectableBranches =
    profile?.role === 'super_admin' ? branches : branches.filter((b) => myBranchIds.includes(b.id));
  const canSubmit = !!branchId && amountOk && Number(envelopeCount) >= 1 && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    const branchName = branches.find((b) => b.id === branchId)?.name || 'สาขานี้';
    if (
      !window.confirm(
        `ส่งซอง ${formatBahtDisplay(amount)} บาท จาก ${branchName}?\n\n` +
          'ยอดที่ส่งแล้วแก้ไม่ได้ ถ้าเขียนผิดต้องยกเลิกแล้วออกใบใหม่'
      )
    ) {
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/cashier/handovers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch_id: branchId,
          declared_amount: amount,
          envelope_count: Number(envelopeCount),
          note: note.trim() || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`✅ ส่งซอง ${formatBahtDisplay(amount)} บาท เรียบร้อย แมสเซนเจอร์เห็นในคิวแล้ว`);
        setAmount('');
        setAmountConfirm('');
        setEnvelopeCount('1');
        setNote('');
        load();
      } else {
        setMessage(`❌ ${data.error}`);
      }
    } catch {
      setMessage('❌ เชื่อมต่อไม่สำเร็จ');
    }
    setSaving(false);
  };

  const cancel = async (row: any) => {
    const reason = window.prompt(
      `ยกเลิกซอง ${formatSatangToBaht(row.declared_amount_satang)} บาท\n\nระบุเหตุผล (อย่างน้อย 5 ตัวอักษร):`
    );
    if (!reason || reason.trim().length < 5) return;
    const res = await fetch(`/api/cashier/handovers/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel', reason: reason.trim() }),
    });
    const data = await res.json();
    setMessage(data.success ? '✅ ยกเลิกซองแล้ว' : `❌ ${data.error}`);
    if (data.success) load();
  };

  if (!canDeclare && !loading) {
    return (
      <div className="empty-search">
        หน้านี้สำหรับแคชเชียร์ของสาขาที่รับเงินสด — บัญชีของคุณไม่ได้อยู่หน่วยงานของสาขาใด
      </div>
    );
  }

  return (
    <div>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="title-badge">💰 ส่งซองเงิน</div>
        <h2>ส่งซองให้แมสเซนเจอร์</h2>
        <div className="title-accent" />
      </div>

      {message && (
        <div
          className={`toast ${message.includes('✅') ? 'success' : 'error'}`}
          style={{ position: 'static', marginBottom: 12 }}
        >
          {message}
        </div>
      )}

      <div className="scan-panel" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: '0.88rem', color: 'var(--muted)', marginBottom: 12 }}>
          กรอกยอดที่เขียนไว้บนหน้าซอง — ยอดนี้จะเป็นยอดที่ระบบใช้เทียบกับเงินที่ธนาคารนับได้
        </div>

        {selectableBranches.length !== 1 && (
          <div className="form-group">
            <label htmlFor="ch-branch">สาขา *</label>
            <select id="ch-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">-- เลือกสาขา --</option>
              {selectableBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {selectableBranches.length === 1 && (
          <div className="form-group">
            <span className="form-label-static">สาขา</span>
            <div style={{ fontWeight: 700 }}>{selectableBranches[0].name}</div>
          </div>
        )}

        <div className="form-group">
          <label htmlFor="ch-count">จำนวนซอง *</label>
          <input
            id="ch-count"
            type="text"
            inputMode="numeric"
            value={envelopeCount}
            onChange={(e) => setEnvelopeCount(e.target.value.replace(/\D/g, ''))}
          />
        </div>

        {/* type="text" + inputMode ไม่ใช่ type="number" — number เลื่อนค่าเพี้ยน
            ตอนสไครลล์ และรูปแบบทศนิยมต่างกันตาม locale */}
        <div className="form-group">
          <label htmlFor="ch-amount">ยอดเงินตามหน้าซอง (บาท) *</label>
          <input
            id="ch-amount"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="เช่น 45000.00"
            style={{ fontSize: '1.25rem', fontWeight: 700 }}
          />
        </div>

        <div className="form-group">
          <label htmlFor="ch-amount-confirm">พิมพ์ยอดอีกครั้งเพื่อยืนยัน *</label>
          <input
            id="ch-amount-confirm"
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
              ยอดที่จะส่ง: <strong style={{ color: 'var(--text)' }}>{formatBahtDisplay(amount)} บาท</strong>
            </div>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="ch-note">หมายเหตุ (ถ้ามี)</label>
          <input id="ch-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <button
          type="button"
          className="secondary-button"
          onClick={submit}
          disabled={!canSubmit}
          style={{ minHeight: 52 }}
        >
          {saving ? 'กำลังส่ง...' : amountOk ? `📤 ส่งซอง ${formatBahtDisplay(amount)} บาท` : '📤 ส่งซอง'}
        </button>
      </div>

      <h3 style={{ marginBottom: 8 }}>ซองที่ส่งไปแล้ว</h3>
      <div className="report-panel">
        {loading ? (
          <div className="empty-search">กำลังโหลด...</div>
        ) : rows.length === 0 ? (
          <div className="empty-search">ยังไม่มีการส่งซอง</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>เลขที่</th>
                  <th>สาขา</th>
                  <th>ยอดหน้าซอง</th>
                  <th>ซอง</th>
                  <th>สถานะ</th>
                  <th>ผู้รับ</th>
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className="code-cell">#{r.handover_no}</span>
                    </td>
                    <td>{r.branch_name || '—'}</td>
                    <td style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {formatSatangToBaht(r.declared_amount_satang)}
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.envelope_count}</td>
                    <td>
                      <span className={`status-badge ${STATUS_CLASS[r.status] || ''}`}>
                        {STATUS_LABEL[r.status] || r.status}
                      </span>
                      {r.status === 'disputed' && r.dispute_reason && (
                        <div style={{ fontSize: '0.78rem', color: 'var(--text)', marginTop: 4 }}>
                          {r.dispute_reason}
                        </div>
                      )}
                    </td>
                    <td>{r.accepted_by_name || '—'}</td>
                    <td>
                      {r.status === 'pending' ? (
                        <button className="table-action-button" onClick={() => cancel(r)}>
                          ✕ ยกเลิก
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
