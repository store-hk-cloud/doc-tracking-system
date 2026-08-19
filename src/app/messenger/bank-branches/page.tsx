'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthProvider';
import { isMessenger } from '@/lib/capabilities';

/**
 * รายชื่อสาขาธนาคารที่ใช้นำฝาก — แมสเซนเจอร์ดูแลเอง
 *
 * ปกติไม่ต้องเข้าหน้านี้: พิมพ์ชื่อสาขาใหม่ในหน้าบันทึกการนำฝาก ระบบเพิ่มเข้า
 * รายชื่อให้เองอยู่แล้ว หน้านี้มีไว้แก้ชื่อที่พิมพ์ผิด และปิดสาขาที่เลิกใช้
 */

type Branch = {
  id: string;
  bank_id: string;
  name: string;
  branch_code: string | null;
  is_active: boolean;
  usage_count: number;
};

type Bank = { id: string; name: string; code: string; is_active: boolean; usage_count: number };

export default function BankBranchesPage() {
  const { profile } = useAuth();
  const canEdit = isMessenger(profile) || profile?.role === 'super_admin';

  const [tab, setTab] = useState<'branches' | 'banks'>('branches');
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankForm, setBankForm] = useState({ name: '', code: '' });
  const [showBankForm, setShowBankForm] = useState(false);
  const [editingBank, setEditingBank] = useState<Bank | null>(null);
  const [editBankForm, setEditBankForm] = useState({ name: '', is_active: true });
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({ bank_id: '', name: '', branch_code: '' });
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [editForm, setEditForm] = useState({ name: '', branch_code: '', is_active: true });

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/messenger/bank-branches');
      const data = await res.json();
      if (data.success) {
        setBanks(data.data.banks);
        setBranches(data.data.branches);
      } else {
        setMessage(`❌ ${data.error}`);
      }
    } catch {
      setMessage('❌ เชื่อมต่อไม่สำเร็จ');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const bankName = (id: string) => banks.find((b) => b.id === id)?.name || 'ธนาคารที่ปิดใช้งาน';

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    const res = await fetch('/api/messenger/bank-branches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (data.success) {
      setMessage(`✅ เพิ่มสาขา ${form.name} แล้ว`);
      setForm({ bank_id: '', name: '', branch_code: '' });
      setShowForm(false);
      load();
    } else {
      setMessage(`❌ ${data.error}`);
    }
    setSaving(false);
  };

  const handleCreateBank = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    const res = await fetch('/api/messenger/bank-branches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity: 'bank', ...bankForm }),
    });
    const data = await res.json();
    if (data.success) {
      setMessage(`✅ เพิ่มธนาคาร ${bankForm.name} แล้ว`);
      setBankForm({ name: '', code: '' });
      setShowBankForm(false);
      load();
    } else {
      setMessage(`❌ ${data.error}`);
    }
    setSaving(false);
  };

  const handleUpdateBank = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBank) return;
    setSaving(true);
    const res = await fetch('/api/messenger/bank-branches', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity: 'bank', id: editingBank.id, ...editBankForm }),
    });
    const data = await res.json();
    if (data.success) {
      setMessage(`✅ แก้ไข ${editBankForm.name} แล้ว`);
      setEditingBank(null);
      load();
    } else {
      setMessage(`❌ ${data.error}`);
    }
    setSaving(false);
  };

  const toggleBankActive = async (row: Bank) => {
    const next = !row.is_active;
    if (
      !next &&
      row.usage_count > 0 &&
      !window.confirm(
        `ปิดใช้งาน "${row.name}"?\n\n` +
          `มีรายการฝากผูกอยู่ ${row.usage_count} รายการ ประวัติยังอยู่ครบ ` +
          'แต่ธนาคารนี้จะไม่ปรากฏให้เลือกในการฝากครั้งต่อไป'
      )
    ) {
      return;
    }
    const res = await fetch('/api/messenger/bank-branches', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity: 'bank', id: row.id, is_active: next }),
    });
    const data = await res.json();
    setMessage(data.success ? `✅ ${next ? 'เปิด' : 'ปิด'}ใช้งาน ${row.name}` : `❌ ${data.error}`);
    if (data.success) load();
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    const res = await fetch('/api/messenger/bank-branches', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editing.id, ...editForm }),
    });
    const data = await res.json();
    if (data.success) {
      setMessage(`✅ แก้ไข ${editForm.name} แล้ว`);
      setEditing(null);
      load();
    } else {
      setMessage(`❌ ${data.error}`);
    }
    setSaving(false);
  };

  const toggleActive = async (row: Branch) => {
    const next = !row.is_active;
    if (
      !next &&
      row.usage_count > 0 &&
      !window.confirm(
        `ปิดใช้งานสาขา "${row.name}"?\n\n` +
          `มีรายการฝากผูกอยู่ ${row.usage_count} รายการ ประวัติยังอยู่ครบ ` +
          'แต่สาขานี้จะไม่ปรากฏให้เลือกในการฝากครั้งต่อไป'
      )
    ) {
      return;
    }
    const res = await fetch('/api/messenger/bank-branches', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id, is_active: next }),
    });
    const data = await res.json();
    setMessage(data.success ? `✅ ${next ? 'เปิด' : 'ปิด'}ใช้งาน ${row.name}` : `❌ ${data.error}`);
    if (data.success) load();
  };

  // จัดกลุ่มตามธนาคาร เพราะสาขาชื่อเดียวกันของต่างธนาคารเป็นคนละที่กัน
  const grouped = banks
    .map((b) => ({ bank: b, rows: branches.filter((r) => r.bank_id === b.id) }))
    .filter((g) => g.rows.length > 0);
  const orphans = branches.filter((r) => !banks.some((b) => b.id === r.bank_id));

  return (
    <div>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="title-badge">🏦 ธนาคาร/สาขาที่ฝาก</div>
        <h2>{tab === 'branches' ? 'รายชื่อสาขาที่ใช้นำฝาก' : 'รายชื่อธนาคาร'}</h2>
        <div className="title-accent" />
      </div>

      <div className="segmented-control" style={{ marginBottom: 12 }}>
        <button type="button" className={tab === 'branches' ? 'active' : ''} onClick={() => setTab('branches')}>
          สาขาธนาคาร
        </button>
        <button type="button" className={tab === 'banks' ? 'active' : ''} onClick={() => setTab('banks')}>
          ธนาคาร
        </button>
      </div>

      <div style={{ fontSize: '0.88rem', color: 'var(--muted)', marginBottom: 12 }}>
        {tab === 'branches'
          ? 'ปกติไม่ต้องมาหน้านี้ — พิมพ์ชื่อสาขาใหม่ในหน้าบันทึกการนำฝากได้เลย ระบบจะเพิ่มเข้ารายชื่อให้เอง หน้านี้ใช้แก้ชื่อที่พิมพ์ผิด และปิดสาขาที่เลิกใช้'
          : 'ธนาคารที่เลือกได้ตอนบันทึกการนำฝาก เพิ่มได้เมื่อบริษัทเปิดบัญชีกับธนาคารใหม่ — การเพิ่มและแก้ไขทุกครั้งถูกบันทึกไว้ตรวจย้อนหลังได้'}
      </div>

      {message && (
        <div
          className={`toast ${message.includes('✅') ? 'success' : 'error'}`}
          style={{ position: 'static', marginBottom: 12 }}
        >
          {message}
        </div>
      )}

      {canEdit && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          {tab === 'branches' ? (
            <button
              className="secondary-button"
              onClick={() => setShowForm(!showForm)}
              style={{ width: 'auto', padding: '0 20px' }}
            >
              {showForm ? '✕ ปิด' : '+ เพิ่มสาขา'}
            </button>
          ) : (
            <button
              className="secondary-button"
              onClick={() => setShowBankForm(!showBankForm)}
              style={{ width: 'auto', padding: '0 20px' }}
            >
              {showBankForm ? '✕ ปิด' : '+ เพิ่มธนาคาร'}
            </button>
          )}
        </div>
      )}

      {tab === 'banks' && showBankForm && canEdit && (
        <div className="scan-panel" style={{ marginBottom: 16 }}>
          <form onSubmit={handleCreateBank}>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="nb-name">ชื่อธนาคาร *</label>
                <input
                  id="nb-name"
                  type="text"
                  value={bankForm.name}
                  onChange={(e) => setBankForm({ ...bankForm, name: e.target.value })}
                  placeholder="เช่น ธนาคารทหารไทยธนชาต"
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="nb-code">รหัสย่อ *</label>
                <input
                  id="nb-code"
                  type="text"
                  value={bankForm.code}
                  onChange={(e) => setBankForm({ ...bankForm, code: e.target.value.toUpperCase() })}
                  placeholder="เช่น TTB"
                  autoCapitalize="characters"
                  spellCheck={false}
                  required
                />
                <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: 4 }}>
                  ตั้งแล้วแก้ไม่ได้ เพราะปรากฏในรายงานย้อนหลัง
                </div>
              </div>
            </div>
            <button type="submit" className="secondary-button" style={{ marginTop: 8 }} disabled={saving}>
              {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
            </button>
          </form>
        </div>
      )}

      {tab === 'branches' && showForm && canEdit && (
        <div className="scan-panel" style={{ marginBottom: 16 }}>
          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label htmlFor="bb-bank">ธนาคาร *</label>
              <select
                id="bb-bank"
                value={form.bank_id}
                onChange={(e) => setForm({ ...form, bank_id: e.target.value })}
                required
              >
                <option value="">-- เลือกธนาคาร --</option>
                {banks
                  .filter((b) => b.is_active)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="bb-name">ชื่อสาขา *</label>
                <input
                  id="bb-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="เช่น สาขาเซ็นทรัลเชียงใหม่"
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="bb-code">รหัสสาขา (ถ้ามีบนสลิป)</label>
                <input
                  id="bb-code"
                  type="text"
                  value={form.branch_code}
                  onChange={(e) => setForm({ ...form, branch_code: e.target.value })}
                  placeholder="เช่น 0123"
                />
              </div>
            </div>
            <button type="submit" className="secondary-button" style={{ marginTop: 8 }} disabled={saving}>
              {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
            </button>
          </form>
        </div>
      )}

      {tab === 'banks' && (
        <div className="report-panel">
          {loading ? (
            <div className="empty-search">กำลังโหลด...</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>รหัส</th>
                    <th>ชื่อธนาคาร</th>
                    <th>สาขาในรายชื่อ</th>
                    <th>ใช้ฝากแล้ว</th>
                    <th>สถานะ</th>
                    {canEdit && <th>จัดการ</th>}
                  </tr>
                </thead>
                <tbody>
                  {banks.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <span className="code-cell">{row.code}</span>
                      </td>
                      <td style={{ fontWeight: 700 }}>{row.name}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {branches.filter((b) => b.bank_id === row.id).length} สาขา
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {row.usage_count > 0 ? `${row.usage_count} ครั้ง` : '-'}
                      </td>
                      <td>
                        <span className={`status-badge${row.is_active ? ' success' : ' error'}`}>
                          {row.is_active ? 'ใช้งาน' : 'ปิดแล้ว'}
                        </span>
                      </td>
                      {canEdit && (
                        <td>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button
                              className="table-action-button"
                              onClick={() => {
                                setEditingBank(row);
                                setEditBankForm({ name: row.name, is_active: row.is_active });
                                setMessage('');
                              }}
                            >
                              ✏️ แก้ไข
                            </button>
                            <button className="table-action-button" onClick={() => toggleBankActive(row)}>
                              {row.is_active ? '🚫 ปิด' : '✅ เปิด'}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="report-panel" style={{ display: tab === 'branches' ? undefined : 'none' }}>
        {loading ? (
          <div className="empty-search">กำลังโหลด...</div>
        ) : branches.length === 0 ? (
          <div className="empty-search">
            ยังไม่มีสาขาในรายชื่อ — จะถูกเพิ่มเองเมื่อบันทึกการนำฝากครั้งแรก
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {[...grouped, ...(orphans.length ? [{ bank: null, rows: orphans }] : [])].map((g, gi) => (
              <div key={g.bank?.id || `orphan-${gi}`}>
                <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>
                  {g.bank ? g.bank.name : 'ธนาคารที่ปิดใช้งานแล้ว'}
                </h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>ชื่อสาขา</th>
                        <th>รหัสสาขา</th>
                        <th>ใช้ฝากแล้ว</th>
                        <th>สถานะ</th>
                        {canEdit && <th>จัดการ</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((row) => (
                        <tr key={row.id}>
                          <td style={{ fontWeight: 700 }}>{row.name}</td>
                          <td>
                            {row.branch_code ? <span className="code-cell">{row.branch_code}</span> : '-'}
                          </td>
                          <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {row.usage_count > 0 ? `${row.usage_count} ครั้ง` : '-'}
                          </td>
                          <td>
                            <span className={`status-badge${row.is_active ? ' success' : ' error'}`}>
                              {row.is_active ? 'ใช้งาน' : 'ปิดแล้ว'}
                            </span>
                          </td>
                          {canEdit && (
                            <td>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                <button
                                  className="table-action-button"
                                  onClick={() => {
                                    setEditing(row);
                                    setEditForm({
                                      name: row.name,
                                      branch_code: row.branch_code || '',
                                      is_active: row.is_active,
                                    });
                                    setMessage('');
                                  }}
                                >
                                  ✏️ แก้ไข
                                </button>
                                <button className="table-action-button" onClick={() => toggleActive(row)}>
                                  {row.is_active ? '🚫 ปิด' : '✅ เปิด'}
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <Link href="/messenger" className="ghost-button" style={{ justifyContent: 'center' }}>
          กลับไปคิวงาน
        </Link>
      </div>

      {editingBank && (
        <div className="scan-popup-overlay" onClick={() => setEditingBank(null)}>
          <div
            className="scan-popup-sheet"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 480, margin: '0 auto' }}
          >
            <div className="scan-popup-handle" />
            <h3 style={{ marginBottom: 4 }}>✏️ แก้ไขธนาคาร</h3>
            <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: 12 }}>
              รหัส <span className="code-cell">{editingBank.code}</span> แก้ไม่ได้
            </div>
            <form onSubmit={handleUpdateBank}>
              <div className="form-group">
                <label htmlFor="ebk-name">ชื่อธนาคาร *</label>
                <input
                  id="ebk-name"
                  type="text"
                  value={editBankForm.name}
                  onChange={(e) => setEditBankForm({ ...editBankForm, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="checkbox"
                  id="ebk-active"
                  checked={editBankForm.is_active}
                  onChange={(e) => setEditBankForm({ ...editBankForm, is_active: e.target.checked })}
                  style={{ width: 20, height: 20 }}
                />
                <label htmlFor="ebk-active" style={{ margin: 0 }}>
                  เปิดให้เลือกตอนบันทึกการฝาก
                </label>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button type="button" className="ghost-button" onClick={() => setEditingBank(null)} style={{ flex: 1 }}>
                  ยกเลิก
                </button>
                <button type="submit" className="secondary-button" style={{ flex: 1 }} disabled={saving}>
                  {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
                </button>
              </div>
            </form>
            <button className="scan-popup-close" onClick={() => setEditingBank(null)}>
              ปิด
            </button>
          </div>
        </div>
      )}

      {editing && (
        <div className="scan-popup-overlay" onClick={() => setEditing(null)}>
          <div
            className="scan-popup-sheet"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 480, margin: '0 auto' }}
          >
            <div className="scan-popup-handle" />
            <h3 style={{ marginBottom: 4 }}>✏️ แก้ไขสาขา</h3>
            <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: 12 }}>
              {bankName(editing.bank_id)} — ย้ายไปธนาคารอื่นไม่ได้
            </div>
            <form onSubmit={handleUpdate}>
              <div className="form-group">
                <label htmlFor="eb-name">ชื่อสาขา *</label>
                <input
                  id="eb-name"
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="eb-code">รหัสสาขา</label>
                <input
                  id="eb-code"
                  type="text"
                  value={editForm.branch_code}
                  onChange={(e) => setEditForm({ ...editForm, branch_code: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="checkbox"
                  id="eb-active"
                  checked={editForm.is_active}
                  onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
                  style={{ width: 20, height: 20 }}
                />
                <label htmlFor="eb-active" style={{ margin: 0 }}>
                  เปิดให้เลือกตอนบันทึกการฝาก
                </label>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button type="button" className="ghost-button" onClick={() => setEditing(null)} style={{ flex: 1 }}>
                  ยกเลิก
                </button>
                <button type="submit" className="secondary-button" style={{ flex: 1 }} disabled={saving}>
                  {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
                </button>
              </div>
            </form>
            <button className="scan-popup-close" onClick={() => setEditing(null)}>
              ปิด
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
