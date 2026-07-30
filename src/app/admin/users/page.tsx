'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';

export default function AdminUsersPage() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'user', department_id: '' });
  const [message, setMessage] = useState('');

  const loadUsers = async () => {
    try {
      const res = await window.fetch('/api/profiles');
      const data = await res.json();
      if (data.success) setUsers(data.data);
    } catch (e) {
      console.error('fetch users error:', e);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadUsers();
    window.fetch('/api/departments').then(r => r.json()).then(data => {
      if (data.success) setDepartments(data.data);
    });
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');

    const res = await window.fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (data.success) {
      setMessage(`✅ สร้างผู้ใช้ ${form.full_name} สำเร็จ`);
      setForm({ email: '', password: '', full_name: '', role: 'user', department_id: '' });
      setShowForm(false);
      loadUsers();
    } else {
      setMessage(`❌ ${data.error}`);
    }
  };

  const roleLabel: Record<string, string> = {
    super_admin: 'ผู้ดูแลระบบ',
    admin: 'ธุรการ',
    user: 'ผู้ใช้',
  };

  return (
    <div>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="title-badge">👥 จัดการผู้ใช้</div>
        <h2>ผู้ใช้ทั้งหมด</h2>
        <div className="title-accent" />
      </div>

      {message && <div className={`toast ${message.includes('✅') ? 'success' : 'error'}`} style={{ position: 'static', marginBottom: 12 }}>{message}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="secondary-button" onClick={() => setShowForm(!showForm)} style={{ width: 'auto', padding: '0 20px' }}>
          {showForm ? '✕ ปิด' : '+ เพิ่มผู้ใช้'}
        </button>
      </div>

      {showForm && (
        <div className="scan-panel" style={{ marginBottom: 16 }}>
          <form onSubmit={handleCreate}>
            <div className="form-row">
              <div className="form-group">
                <label>ชื่อ-นามสกุล *</label>
                <input type="text" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>อีเมล *</label>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>รหัสผ่าน *</label>
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>บทบาท</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  <option value="user">ผู้ใช้ (User)</option>
                  <option value="admin">ธุรการ (Admin)</option>
                  <option value="super_admin">ผู้ดูแลระบบ (Super Admin)</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>หน่วยงาน</label>
              <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
                <option value="">-- เลือกหน่วยงาน --</option>
                {departments.map((d: any) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="secondary-button" style={{ marginTop: 8 }}>
              💾 บันทึกผู้ใช้
            </button>
          </form>
        </div>
      )}

      <div className="report-panel">
        {loading ? (
          <div className="empty-search">กำลังโหลด...</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ชื่อ-นามสกุล</th>
                  <th>อีเมล</th>
                  <th>บทบาท</th>
                  <th>หน่วยงาน</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u: any) => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 700 }}>{u.full_name}</td>
                    <td>{u.email}</td>
                    <td>
                      <span className={`status-badge${u.role === 'super_admin' ? ' success' : ''}`}>
                        {roleLabel[u.role] || u.role}
                      </span>
                    </td>
                    <td>{u.department_name || '-'}</td>
                    <td>
                      <span className={`status-badge${u.is_active ? ' success' : ' error'}`}>
                        {u.is_active ? 'ใช้งาน' : 'ระงับ'}
                      </span>
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