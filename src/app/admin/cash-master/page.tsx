'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { canViewCash } from '@/lib/capabilities';

/**
 * จัดการข้อมูลหลักของโมดูลเงินสด — ฝ่ายบัญชีดูแลเองได้ ไม่ต้องรอฝ่ายไอที
 *
 * "สาขา" ที่นี่คือ **สาขาบริษัท** จุดที่แมสเซนเจอร์ไปรับซองเงิน
 * ส่วนสาขาธนาคารเป็นข้อความที่กรอกตอนบันทึกการนำฝาก ไม่ต้องตั้งค่าล่วงหน้า
 *
 * ไม่มีปุ่มลบโดยเจตนา — รายการที่เคยใช้งานถูกอ้างจากรายการเงินย้อนหลัง
 * ลบแล้วประวัติจะอ่านไม่ออก จึงใช้การปิดใช้งานแทน (หายจาก dropdown ทันที)
 */

type Row = {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  department_id?: string | null;
  usage_count: number;
};

type Dept = { id: string; name: string; code: string };

// เหลือแค่สาขาบริษัท — ธนาคารและสาขาธนาคารย้ายไปให้แมสเซนเจอร์ดูแล
// ที่ /messenger/bank-branches เพราะเป็นข้อมูลที่เกิดจากงานของเขาโดยตรง
const TABS = [{ key: 'branches' as const, label: '🏢 สาขาบริษัท (จุดรับเงิน)' }];

export default function CashMasterPage() {
  const { profile } = useAuth();
  const isEditor =
    profile?.role === 'super_admin' || (profile?.role === 'admin' && canViewCash(profile));

  const [tab, setTab] = useState<'branches' | 'approved_banks'>('branches');
  const [branches, setBranches] = useState<Row[]>([]);
  const [banks, setBanks] = useState<Row[]>([]);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', department_id: '' });
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<Row | null>(null);
  const [editForm, setEditForm] = useState({ name: '', department_id: '', is_active: true });

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/cash-master');
      const data = await res.json();
      if (data.success) {
        setBranches(data.data.branches);
        setBanks(data.data.banks);
        setDepartments(data.data.departments);
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

  const rows = tab === 'branches' ? branches : banks;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/admin/cash-master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: tab,
          name: form.name,
          code: form.code,
          department_id: tab === 'branches' ? form.department_id || null : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`✅ เพิ่ม ${form.name} สำเร็จ`);
        setForm({ name: '', code: '', department_id: '' });
        setShowForm(false);
        load();
      } else {
        setMessage(`❌ ${data.error}`);
      }
    } catch {
      setMessage('❌ เชื่อมต่อไม่สำเร็จ');
    }
    setSaving(false);
  };

  const openEdit = (row: Row) => {
    setEditing(row);
    setEditForm({
      name: row.name,
      department_id: row.department_id || '',
      is_active: row.is_active,
    });
    setMessage('');
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/cash-master', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: tab,
          id: editing.id,
          name: editForm.name,
          is_active: editForm.is_active,
          department_id: tab === 'branches' ? editForm.department_id || null : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`✅ แก้ไข ${editForm.name} สำเร็จ`);
        setEditing(null);
        load();
      } else {
        setMessage(`❌ ${data.error}`);
      }
    } catch {
      setMessage('❌ เชื่อมต่อไม่สำเร็จ');
    }
    setSaving(false);
  };

  const toggleActive = async (row: Row) => {
    const next = !row.is_active;
    if (
      !next &&
      row.usage_count > 0 &&
      !window.confirm(
        `ปิดใช้งาน "${row.name}"?\n\n` +
          `รายการนี้มีประวัติผูกอยู่ ${row.usage_count} รายการ ` +
          'ประวัติเดิมยังอยู่ครบ แต่จะไม่ปรากฏให้เลือกในงานใหม่'
      )
    ) {
      return;
    }
    const res = await fetch('/api/admin/cash-master', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: tab, id: row.id, is_active: next }),
    });
    const data = await res.json();
    setMessage(data.success ? `✅ ${next ? 'เปิด' : 'ปิด'}ใช้งาน ${row.name}` : `❌ ${data.error}`);
    if (data.success) load();
  };

  if (!isEditor) {
    return (
      <div className="empty-search">
        หน้านี้สำหรับธุรการฝ่ายบัญชีและผู้ดูแลระบบเท่านั้น
      </div>
    );
  }

  return (
    <div>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="title-badge">🗂 ข้อมูลหลักงานเงินสด</div>
        <h2>สาขาบริษัท (จุดรับซองเงิน)</h2>
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

      <div className="segmented-control" style={{ marginBottom: 12 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={tab === t.key ? 'active' : ''}
            onClick={() => {
              setTab(t.key);
              setShowForm(false);
              setEditing(null);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ fontSize: '0.88rem', color: 'var(--muted)', marginBottom: 12 }}>
        จุดที่แมสเซนเจอร์ไปรับซองเงิน — <strong>ไม่ใช่สาขาธนาคาร</strong>
        แผนกที่ดูแลใช้ส่งแจ้งเตือนตอนเงินถูกรับไป
        <div style={{ marginTop: 4 }}>
          ส่วนธนาคารและสาขาธนาคาร แมสเซนเจอร์ดูแลเองที่เมนู “ธนาคาร/สาขาที่ฝาก”
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button
          className="secondary-button"
          onClick={() => setShowForm(!showForm)}
          style={{ width: 'auto', padding: '0 20px' }}
        >
          {showForm ? '✕ ปิด' : tab === 'branches' ? '+ เพิ่มสาขา' : '+ เพิ่มธนาคาร'}
        </button>
      </div>

      {showForm && (
        <div className="scan-panel" style={{ marginBottom: 16 }}>
          <form onSubmit={handleCreate}>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="new-name">ชื่อ *</label>
                <input
                  id="new-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={tab === 'branches' ? 'เช่น สาขามหิดล' : 'เช่น ธนาคารทหารไทยธนชาต'}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="new-code">รหัส *</label>
                <input
                  id="new-code"
                  type="text"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder={tab === 'branches' ? 'เช่น 0-BSN11' : 'เช่น TTB'}
                  autoCapitalize="characters"
                  spellCheck={false}
                  required
                />
                <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: 4 }}>
                  ตั้งแล้วแก้ไม่ได้ เพราะรหัสนี้ปรากฏในรายงานย้อนหลัง
                </div>
              </div>
            </div>
            {tab === 'branches' && (
              <div className="form-group">
                <label htmlFor="new-dept">แผนกที่ดูแลสาขานี้ (ใช้ส่งแจ้งเตือน)</label>
                <select
                  id="new-dept"
                  value={form.department_id}
                  onChange={(e) => setForm({ ...form, department_id: e.target.value })}
                >
                  <option value="">-- ไม่ระบุ --</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.code} · {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button type="submit" className="secondary-button" style={{ marginTop: 8 }} disabled={saving}>
              {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
            </button>
          </form>
        </div>
      )}

      <div className="report-panel">
        {loading ? (
          <div className="empty-search">กำลังโหลด...</div>
        ) : rows.length === 0 ? (
          <div className="empty-search">ยังไม่มีข้อมูล</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>รหัส</th>
                  <th>ชื่อ</th>
                  {tab === 'branches' && <th>แผนกที่ดูแล</th>}
                  <th>ใช้งานแล้ว</th>
                  <th>สถานะ</th>
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className="code-cell">{row.code}</span>
                    </td>
                    <td style={{ fontWeight: 700 }}>{row.name}</td>
                    {tab === 'branches' && (
                      <td>{departments.find((d) => d.id === row.department_id)?.name || '-'}</td>
                    )}
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {row.usage_count > 0 ? `${row.usage_count} รายการ` : '-'}
                    </td>
                    <td>
                      <span className={`status-badge${row.is_active ? ' success' : ' error'}`}>
                        {row.is_active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="table-action-button" onClick={() => openEdit(row)}>
                          ✏️ แก้ไข
                        </button>
                        <button className="table-action-button" onClick={() => toggleActive(row)}>
                          {row.is_active ? '🚫 ปิด' : '✅ เปิด'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <div className="scan-popup-overlay" onClick={() => setEditing(null)}>
          <div
            className="scan-popup-sheet"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 480, margin: '0 auto' }}
          >
            <div className="scan-popup-handle" />
            <h3 style={{ marginBottom: 4 }}>✏️ แก้ไข {editing.name}</h3>
            <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: 12 }}>
              รหัส <span className="code-cell">{editing.code}</span> แก้ไม่ได้
            </div>
            <form onSubmit={handleUpdate}>
              <div className="form-group">
                <label htmlFor="edit-name">ชื่อ *</label>
                <input
                  id="edit-name"
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  required
                />
              </div>
              {tab === 'branches' && (
                <div className="form-group">
                  <label htmlFor="edit-dept">แผนกที่ดูแลสาขานี้</label>
                  <select
                    id="edit-dept"
                    value={editForm.department_id}
                    onChange={(e) => setEditForm({ ...editForm, department_id: e.target.value })}
                  >
                    <option value="">-- ไม่ระบุ --</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.code} · {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="checkbox"
                  id="edit-active"
                  checked={editForm.is_active}
                  onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
                  style={{ width: 20, height: 20 }}
                />
                <label htmlFor="edit-active" style={{ margin: 0 }}>
                  เปิดให้เลือกในงานใหม่
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
