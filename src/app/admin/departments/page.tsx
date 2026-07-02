'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function AdminDepartmentsPage() {
  const supabase = createClient();
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDept, setNewDept] = useState({ name: '', code: '' });
  const [message, setMessage] = useState('');

  const fetchDepts = async () => {
    const { data } = await supabase.from('departments').select('*').order('name');
    if (data) setDepartments(data);
    setLoading(false);
  };

  useEffect(() => { fetchDepts(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDept.name || !newDept.code) return;

    const res = await fetch('/api/departments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newDept),
    });
    const data = await res.json();
    if (data.success) {
      setMessage(`✅ เพิ่มหน่วยงาน ${newDept.name} สำเร็จ`);
      setNewDept({ name: '', code: '' });
      fetchDepts();
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
                </tr>
              </thead>
              <tbody>
                {departments.map((d: any) => (
                  <tr key={d.id}>
                    <td className="code-cell">{d.code}</td>
                    <td style={{ fontWeight: 700 }}>{d.name}</td>
                    <td>{new Date(d.created_at).toLocaleDateString('th-TH')}</td>
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