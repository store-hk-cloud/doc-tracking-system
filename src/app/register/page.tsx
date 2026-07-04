'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { createClient } from '@/lib/supabase/client';

const DOCUMENT_TYPES = ['จดหมาย', 'ใบกำกับภาษี', 'ใบวางบิล', 'พัสดุ', 'ใบเสร็จ', 'บิลต่างๆ'];

export default function RegisterPage() {
  const { user } = useAuth();
  const supabase = createClient();
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    received_date: new Date().toISOString().split('T')[0],
    doc_number: '',
    sender: '',
    subject: '',
    recipient_dept_id: '',
    note: '',
    is_damaged: false,
  });

  const selectDocumentType = (type: string) => {
    setForm((current) => ({
      ...current,
      subject: current.subject && !DOCUMENT_TYPES.includes(current.subject) ? current.subject : type,
    }));
  };

  useEffect(() => {
    supabase.from('departments').select('*').order('name').then(({ data }) => {
      if (data) setDepartments(data);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    if (!form.sender || !form.subject || !form.recipient_dept_id) {
      setError('กรุณากรอกข้อมูลที่จำเป็น (ผู้ส่ง, เรื่อง, หน่วยงาน)');
      setLoading(false);
      return;
    }

    const res = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        recorded_by: user?.id,
      }),
    });

    const data = await res.json();
    if (data.success) {
      setSuccess(`✅ ลงทะเบียนสำเร็จ! Running No. #${data.data.running_no}`);
      setForm({
        received_date: new Date().toISOString().split('T')[0],
        doc_number: '',
        sender: '',
        subject: '',
        recipient_dept_id: '',
        note: '',
        is_damaged: false,
      });
    } else {
      setError(data.error || 'เกิดข้อผิดพลาด');
    }
    setLoading(false);
  };

  return (
    <div>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="document-type-strip" aria-label="รายการเอกสาร">
          {DOCUMENT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className={`document-type-chip ${form.subject === type ? 'active' : ''}`}
              onClick={() => selectDocumentType(type)}
            >
              {type}
            </button>
          ))}
        </div>
        <div className="title-badge">📝 ลงทะเบียน</div>
        <h2>ลงทะเบียนเอกสารเข้า</h2>
        <div className="title-accent" />
      </div>

      {success && <div className="toast success" style={{ position: 'static', marginBottom: 12 }}>{success}</div>}
      {error && <div className="toast error" style={{ position: 'static', marginBottom: 12 }}>{error}</div>}

      <div className="scan-panel">
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>วันที่รับ *</label>
              <input type="date" value={form.received_date} onChange={(e) => setForm({ ...form, received_date: e.target.value })} />
            </div>
            <div className="form-group">
              <label>เลขที่เอกสาร</label>
              <input type="text" value={form.doc_number} onChange={(e) => setForm({ ...form, doc_number: e.target.value })} placeholder="เช่น INV-2024-001" />
            </div>
          </div>

          <div className="form-group">
            <label>ผู้ส่ง *</label>
            <input type="text" value={form.sender} onChange={(e) => setForm({ ...form, sender: e.target.value })} placeholder="ชื่อผู้ส่ง / บริษัท" required />
          </div>

          <div className="form-group">
            <label>เรื่อง *</label>
            <input type="text" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="หัวข้อเอกสาร" required />
          </div>

          <div className="form-group">
            <label>หน่วยงานผู้รับ *</label>
            <select value={form.recipient_dept_id} onChange={(e) => setForm({ ...form, recipient_dept_id: e.target.value })} required>
              <option value="">-- เลือกหน่วยงาน --</option>
              {departments.map((d: any) => (
                <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="checkbox" id="is_damaged" checked={form.is_damaged} onChange={(e) => setForm({ ...form, is_damaged: e.target.checked })} style={{ width: 20, height: 20 }} />
            <label htmlFor="is_damaged" style={{ margin: 0 }}>พัสดุ/เอกสารเสียหาย (ถ่ายรูปไว้ใน Google Drive)</label>
          </div>

          <div className="form-group">
            <label>หมายเหตุ</label>
            <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="หมายเหตุเพิ่มเติม..." />
          </div>

          <button type="submit" className="secondary-button" disabled={loading} style={{ marginTop: 8 }}>
            {loading ? 'กำลังบันทึก...' : '💾 บันทึกเอกสาร'}
          </button>
        </form>
      </div>
    </div>
  );
}
