'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';

export default function AdminDepartmentsPage() {
  const { profile } = useAuth();
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDept, setNewDept] = useState({ name: '', code: '' });
  const [message, setMessage] = useState('');
  const isSuperAdmin = profile?.role === 'super_admin';

  const loadDepts = async () => {
    try {
      const res = await window.fetch('/api/departments');
      const data = await res.json();
      if (data.success) setDepartments(data.data);
    } catch (e) {
      console.error('fetch departments error:', e);
    }
    setLoading(false);
  };

  useEffect(() => { loadDepts(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDept.name || !newDept.code) return;

    const res = await window.fetch('/api/departments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newDept),
    });
    const data = await res.json();
    if (data.success) {
      setMessage(`✅ เพิ่มหน่วยงาน ${newDept.name} สำเร็จ`);
      setNewDept({ name: '', code: '' });
      loadDepts();
    } else {
      setMessage(`❌ ${data.error}`);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`⚠️ ลบหน่วยงาน "${name}"? เอกสารที่เกี่ยวข้องจะถูกลบด้วย`)) return;
    const res = await window.fetch('/api/departments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (data.success) {
      setMessage(`✅ ลบหน่วยงาน ${name} สำเร็จ`);
      loadDepts();
    } else {
      setMessage(`❌ ${data.error}`);
    }
  };

  return (
    <div>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="title-badge">🏢 จัดการหน่วยงาน</div>
        <h2>หน่วยงานทั้งหมด</h2>
        <div className="title-accent" />
      </div>

      {message && <div className={`toast ${message.includes('✅') ? 'success' : 'error'}`} style={{ position: 'static', marginBottom: 12 }}>{message}</div>}

      <div className="scan-panel" style={{ marginBottom: 16 }}>
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 10, alignItems: 'end' }}>
          <div className="form-group" style={{ flex: 1, margin: 0 }}>
            <label>ชื่อหน่วยงาน</label>
            <input type="text" value={newDept.name} onChange={(e) => setNewDept({ ...newDept, name: e.target.value })} placeholder="ชื่อหน่วยงาน" required />
          </div>
          <div className="form-group" style={{ flex: 0.4, margin: 0 }}>
            <label>รหัส</label>
            <input type="text" value={newDept.code} onChange={(e) => setNewDept({ ...newDept, code: e.target.value })} placeholder="CODE" required />
          </div>
          <button type="submit" className="secondary-button" style={{ width: 'auto', padding: '0 20px', minHeight: 44 }}>
            + เพิ่ม
          </button>
        </form>
      </div>

      <div className="report-panel">
        {loading ? (
          <div className="empty-search">กำลังโหลด...</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>รหัส</th>
                  <th>ชื่อหน่วยงาน</th>
                  <th>วันที่สร้าง</th>
                  {isSuperAdmin && <th>จัดการ</th>}
                </tr>
              </thead>
              <tbody>
                {departments.map((d: any) => (
                  <tr key={d.id}>
                    <td className="code-cell">{d.code}</td>
                    <td style={{ fontWeight: 700 }}>{d.name}</td>
                    <td>{new Date(d.created_at).toLocaleDateString('th-TH')}</td>
                    {isSuperAdmin && (
                      <td>
                        <button
                          className="table-action-button danger"
                          onClick={() => handleDelete(d.id, d.name)}
                          style={{ background: 'var(--danger)', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: '0.8rem' }}
                        >
                          🗑 ลบ
                        </button>
                      </td>
                    )}
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