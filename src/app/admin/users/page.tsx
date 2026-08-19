'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';

export default function AdminUsersPage() {
  const { user, profile } = useAuth();
  const isSuperAdmin = profile?.role === 'super_admin';
  const [users, setUsers] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ email: '', username: '', password: '', full_name: '', role: 'user', department_id: '' });
  const [message, setMessage] = useState('');
  const [editingUser, setEditingUser] = useState<any>(null);
  const [editForm, setEditForm] = useState({ full_name: '', department_id: '', role: 'user', is_active: true });
  // ตั้งรหัสผ่านใหม่แยกจากฟอร์มแก้ไข เพราะกดแล้วมีผลทันทีและย้อนกลับไม่ได้
  const [newPassword, setNewPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState('');

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
      setForm({ email: '', username: '', password: '', full_name: '', role: 'user', department_id: '' });
      setShowForm(false);
      loadUsers();
    } else {
      setMessage(`❌ ${data.error}`);
    }
  };

  const openEdit = (u: any) => {
    setEditingUser(u);
    setEditForm({
      full_name: u.full_name,
      department_id: u.department_id || '',
      role: u.role,
      is_active: u.is_active,
    });
    setMessage('');
    setNewPassword('');
    setResetMessage('');
  };

  const handleResetPassword = async () => {
    if (!editingUser) return;
    if (newPassword.length < 8) {
      setResetMessage('❌ รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
      return;
    }
    const label = editingUser.username || editingUser.email;
    if (!window.confirm(`ตั้งรหัสผ่านใหม่ให้ "${editingUser.full_name}" (${label})?\n\nรหัสผ่านเดิมจะใช้ไม่ได้ทันที และการกดครั้งนี้จะถูกบันทึกไว้ถาวร`)) return;

    setResetting(true);
    setResetMessage('');
    try {
      const res = await window.fetch(`/api/profiles/${editingUser.id}/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      });
      const data = await res.json();
      if (data.success) {
        setResetMessage(`✅ ตั้งรหัสผ่านใหม่ให้ ${editingUser.full_name} แล้ว — แจ้งเจ้าตัวโดยตรง`);
        setNewPassword('');
      } else {
        setResetMessage(`❌ ${data.error}`);
      }
    } catch {
      setResetMessage('❌ เชื่อมต่อไม่สำเร็จ');
    }
    setResetting(false);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await window.fetch(`/api/profiles/${editingUser.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    });
    const data = await res.json();
    if (data.success) {
      setMessage(`✅ แก้ไขผู้ใช้ ${editForm.full_name} สำเร็จ`);
      setEditingUser(null);
      loadUsers();
    } else {
      setMessage(`❌ ${data.error}`);
    }
  };

  const handleDelete = async (u: any) => {
    if (!window.confirm(`⚠️ ลบผู้ใช้ "${u.full_name}"?`)) return;
    const res = await window.fetch(`/api/profiles/${u.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      setMessage(`✅ ลบผู้ใช้ ${u.full_name} สำเร็จ`);
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
                <label>อีเมล</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="เว้นว่างได้ถ้าใช้ชื่อผู้ใช้"
                />
              </div>
            </div>
            {/* แมสเซนเจอร์ไม่มีอีเมลบริษัท จึงล็อกอินด้วยชื่อผู้ใช้แทนได้
                ระบบจะสร้างอีเมลภายในให้เองเพราะ Supabase Auth ต้องมีอีเมลเสมอ */}
            <div className="form-group">
              <label>ชื่อผู้ใช้ (สำหรับล็อกอินแทนอีเมล)</label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="a-z 0-9 . _ - เช่น somchai"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: 4 }}>
                ต้องกรอกอย่างน้อยหนึ่งอย่างระหว่างอีเมลกับชื่อผู้ใช้
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>รหัสผ่าน *</label>
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
              </div>
              {isSuperAdmin ? (
                <div className="form-group">
                  <label>บทบาท</label>
                  <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                    <option value="user">ผู้ใช้ (User)</option>
                    <option value="admin">ธุรการ (Admin)</option>
                    <option value="super_admin">ผู้ดูแลระบบ (Super Admin)</option>
                  </select>
                </div>
              ) : (
                <div className="form-group">
                  <label>บทบาท</label>
                  <input type="text" value="ผู้ใช้ (User)" disabled />
                </div>
              )}
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
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u: any) => {
                  const isSelf = u.id === user?.id;
                  return (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 700 }}>{u.full_name}</td>
                      <td>{u.username ? <span className="code-cell">{u.username}</span> : u.email}</td>
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
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => openEdit(u)}
                            style={{ background: 'var(--surface-soft)', border: '1px solid var(--line-strong)', padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: '0.8rem' }}
                          >
                            ✏️ แก้ไข
                          </button>
                          {!isSelf && (
                            <button
                              onClick={() => handleDelete(u)}
                              style={{ background: 'var(--danger)', color: 'white', border: 'none', padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: '0.8rem' }}
                            >
                              🗑 ลบ
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editingUser && (
        <div className="scan-popup-overlay" onClick={() => setEditingUser(null)}>
          <div className="scan-popup-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, margin: '0 auto' }}>
            <div className="scan-popup-handle" />
            <h3 style={{ marginBottom: 12 }}>✏️ แก้ไขผู้ใช้ {editingUser.full_name}</h3>
            <form onSubmit={handleUpdate}>
              <div className="form-group">
                <label>ชื่อ-นามสกุล *</label>
                <input type="text" value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>หน่วยงาน</label>
                <select value={editForm.department_id} onChange={(e) => setEditForm({ ...editForm, department_id: e.target.value })}>
                  <option value="">-- เลือกหน่วยงาน --</option>
                  {departments.map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              {isSuperAdmin && editingUser.id !== user?.id ? (
                <div className="form-group">
                  <label>บทบาท</label>
                  <select value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}>
                    <option value="user">ผู้ใช้ (User)</option>
                    <option value="admin">ธุรการ (Admin)</option>
                    <option value="super_admin">ผู้ดูแลระบบ (Super Admin)</option>
                  </select>
                </div>
              ) : (
                <div className="form-group">
                  <label>บทบาท</label>
                  <input type="text" value={roleLabel[editForm.role] || editForm.role} disabled />
                </div>
              )}
              {editingUser.id !== user?.id && (
                <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="checkbox"
                    id="is_active"
                    checked={editForm.is_active}
                    onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
                    style={{ width: 20, height: 20 }}
                  />
                  <label htmlFor="is_active" style={{ margin: 0 }}>เปิดใช้งานบัญชีนี้</label>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button type="button" className="ghost-button" onClick={() => setEditingUser(null)} style={{ flex: 1 }}>
                  ยกเลิก
                </button>
                <button type="submit" className="secondary-button" style={{ flex: 1 }}>
                  💾 บันทึก
                </button>
              </div>
            </form>

            {/* อยู่นอก <form> ด้านบนโดยตั้งใจ: HTML ซ้อน form ไม่ได้ และการตั้งรหัสผ่าน
                ต้องไม่ถูกส่งไปพร้อมการกด "บันทึก" ของฟอร์มแก้ไขข้อมูล */}
            {isSuperAdmin && (
              <div
                style={{
                  marginTop: 18,
                  paddingTop: 14,
                  borderTop: '1px solid var(--line-strong)',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>🔑 ตั้งรหัสผ่านใหม่</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: 10 }}>
                  {editingUser.username
                    ? 'บัญชีนี้ล็อกอินด้วยชื่อผู้ใช้ ไม่มีอีเมลจริงให้ส่งลิงก์รีเซ็ต จึงต้องตั้งให้จากที่นี่'
                    : 'ตั้งรหัสผ่านใหม่แทนผู้ใช้ แล้วแจ้งเจ้าตัวโดยตรง'}
                </div>

                {resetMessage && (
                  <div
                    className={`toast ${resetMessage.includes('✅') ? 'success' : 'error'}`}
                    style={{ position: 'static', marginBottom: 10 }}
                  >
                    {resetMessage}
                  </div>
                )}

                <div className="form-group">
                  <label htmlFor="new-password">รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)</label>
                  <input
                    id="new-password"
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="พิมพ์รหัสผ่านใหม่"
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  {/* type="text" โดยตั้งใจ: ผู้ดูแลเป็นคนตั้งให้คนอื่นแล้วต้องอ่านออกเพื่อบอกต่อ
                      ถ้าซ่อนเป็นจุดจะพิมพ์ผิดแล้วไม่รู้ตัว จนเจ้าตัวล็อกอินไม่ได้ */}
                </div>

                <button
                  type="button"
                  className="ghost-button"
                  onClick={handleResetPassword}
                  disabled={resetting || newPassword.length < 8}
                  style={{ width: '100%', minHeight: 48 }}
                >
                  {resetting ? 'กำลังตั้งรหัสผ่าน...' : '🔑 ตั้งรหัสผ่านใหม่ทันที'}
                </button>
              </div>
            )}

            <button className="scan-popup-close" onClick={() => setEditingUser(null)}>ปิด</button>
          </div>
        </div>
      )}
    </div>
  );
}
