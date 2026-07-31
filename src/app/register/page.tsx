'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { createClient } from '@/lib/supabase/client';

const DOCUMENT_TYPES = [
  'จดหมาย', 'ใบกำกับภาษี', 'ใบวางบิล', 'พัสดุ', 'ใบเสร็จ', 'บิลต่างๆ',
  'ใบเบิก', 'ใบรับสินค้าสำเร็จรูป', 'ใบรับสินค้า', 'ใบโอนสินค้า',
];

export default function RegisterPage() {
  const { user } = useAuth();
  const supabase = createClient();
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [sharing, setSharing] = useState(false);

  const [form, setForm] = useState({
    received_date: new Date().toISOString().split('T')[0],
    doc_number: '',
    sender: '',
    subject: '',
    recipient_dept_id: '',
    note: '',
    is_damaged: false,
  });

  // Photo lives only in memory (object URL / File) — never written to device storage.
  const clearPhoto = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(null);
    setPhotoPreview('');
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleShareLine = async () => {
    if (!photoFile) return;
    const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
    if (!nav.share || !nav.canShare || !nav.canShare({ files: [photoFile] })) {
      setError('อุปกรณ์นี้ไม่รองรับการแชร์รูปโดยตรง กรุณาบันทึกรูปแล้วแชร์ผ่านแอป LINE เอง');
      return;
    }
    setSharing(true);
    try {
      await nav.share({
        files: [photoFile],
        title: 'รูปความเสียหาย',
        text: `พัสดุ/เอกสารเสียหาย: ${form.subject || ''} (${form.sender || ''})`,
      });
    } catch (err: any) {
      if (err?.name !== 'AbortError') setError('แชร์รูปไม่สำเร็จ');
    }
    setSharing(false);
  };

  const selectDocumentType = (type: string) => {
    setForm((current) => ({
      ...current,
      subject: type,
    }));
  };

  useEffect(() => {
    supabase.from('departments').select('*').order('name').then(({ data }) => {
      if (data) setDepartments(data);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

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

    let damage_image_url = '';
    if (form.is_damaged && photoFile) {
      const uploadForm = new FormData();
      uploadForm.append('file', photoFile);
      uploadForm.append('folder', 'damage');
      const uploadRes = await fetch('/api/upload-to-drive', { method: 'POST', body: uploadForm });
      const uploadData = await uploadRes.json();
      if (!uploadData.success) {
        setError(`อัปโหลดรูปไม่สำเร็จ: ${uploadData.error}`);
        setLoading(false);
        return;
      }
      damage_image_url = uploadData.data.viewLink;
    }

    const res = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        damage_image_url,
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
      clearPhoto();
    } else {
      setError(data.error || 'เกิดข้อผิดพลาด');
    }
    setLoading(false);
  };

  return (
    <div>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="document-type-strip" role="group" aria-label="รายการเอกสาร">
          {DOCUMENT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className={`document-type-chip ${form.subject === type ? 'active' : ''}`}
              aria-pressed={form.subject === type}
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
            <input
              type="checkbox"
              id="is_damaged"
              checked={form.is_damaged}
              onChange={(e) => {
                const checked = e.target.checked;
                setForm({ ...form, is_damaged: checked });
                if (!checked) clearPhoto();
              }}
              style={{ width: 20, height: 20 }}
            />
            <label htmlFor="is_damaged" style={{ margin: 0 }}>พัสดุ/เอกสารเสียหาย (ถ่ายรูปไว้ใน Google Drive)</label>
          </div>

          {form.is_damaged && (
            <div className="form-group">
              <label>รูปความเสียหาย</label>
              {!photoPreview ? (
                <label
                  htmlFor="damage_photo"
                  className="ghost-button"
                  style={{ display: 'inline-flex', width: 'auto', padding: '0 20px', cursor: 'pointer' }}
                >
                  📷 ถ่ายรูป / เลือกรูป
                </label>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  <img
                    src={photoPreview}
                    alt="รูปความเสียหาย"
                    style={{ maxWidth: 220, borderRadius: 8, border: '1px solid var(--line)' }}
                  />
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={handleShareLine}
                      disabled={sharing}
                      style={{ width: 'auto', padding: '0 16px' }}
                    >
                      {sharing ? 'กำลังแชร์...' : '📤 แชร์ไลน์'}
                    </button>
                    <label
                      htmlFor="damage_photo"
                      className="ghost-button"
                      style={{ display: 'inline-flex', width: 'auto', padding: '0 16px', cursor: 'pointer' }}
                    >
                      🔄 ถ่ายใหม่
                    </label>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={clearPhoto}
                      style={{ width: 'auto', padding: '0 16px' }}
                    >
                      🗑 ลบรูป
                    </button>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                    รูปจะถูกเก็บไว้ชั่วคราวในเครื่องระหว่างทำรายการนี้เท่านั้น ไม่ถูกบันทึกลงเครื่อง — เมื่อกดบันทึกเอกสาร รูปจะถูกอัปโหลดขึ้น Google Drive โดยตรง
                  </div>
                </div>
              )}
              <input
                id="damage_photo"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoChange}
                style={{ display: 'none' }}
              />
            </div>
          )}

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
