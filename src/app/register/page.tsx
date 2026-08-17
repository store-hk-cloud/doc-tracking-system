'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { createClient } from '@/lib/supabase/client';

const DOCUMENT_TYPES = [
  'จดหมาย', 'ใบกำกับภาษี', 'ใบวางบิล', 'พัสดุ', 'ใบเสร็จ', 'บิลต่างๆ',
  'ใบเบิก', 'ใบรับสินค้าสำเร็จรูป', 'ใบรับสินค้า', 'ใบโอนสินค้า', 'เอกสารอื่นๆ',
];

const initialForm = {
  received_date: new Date().toISOString().split('T')[0],
  doc_number: '',
  tax_invoice_no: '',
  sender: '',
  subject: '',
  recipient_dept_ids: [] as string[],
  inspector_signature: '',
  purchasing_signature: '',
  note: '',
  is_damaged: false,
};

type QueueItem = {
  id: string;
  form: typeof initialForm;
  photoFile: File | null;
  photoPreview: string;
  error?: string;
};

export default function RegisterPage() {
  const { user } = useAuth();
  const supabase = createClient();
  const [departments, setDepartments] = useState<any[]>([]);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [sharing, setSharing] = useState(false);

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({ ...initialForm });
  const isGoodsReceipt = form.subject === 'ใบรับสินค้า';

  const toggleDept = (deptId: string) => {
    setForm((current) => ({
      ...current,
      recipient_dept_ids: current.recipient_dept_ids.includes(deptId)
        ? current.recipient_dept_ids.filter((id) => id !== deptId)
        : [...current.recipient_dept_ids, deptId],
    }));
  };

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

  const handleAddToQueue = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!form.sender || !form.subject || form.recipient_dept_ids.length === 0) {
      setError('กรุณากรอกข้อมูลที่จำเป็น (ผู้ส่ง, เรื่อง, หน่วยงานอย่างน้อย 1 หน่วยงาน)');
      return;
    }

    setQueue((current) => [
      ...current,
      { id: crypto.randomUUID(), form: { ...form }, photoFile, photoPreview },
    ]);
    setForm({ ...initialForm });
    // Ownership of the photo/preview moves into the queue item — don't revoke it here.
    setPhotoFile(null);
    setPhotoPreview('');
  };

  const handleRemoveFromQueue = (id: string) => {
    setQueue((current) => {
      const item = current.find((q) => q.id === id);
      if (item?.photoPreview) URL.revokeObjectURL(item.photoPreview);
      return current.filter((q) => q.id !== id);
    });
  };

  const submitQueueItem = async (item: QueueItem) => {
    let damage_image_url = '';
    if (item.form.is_damaged && item.photoFile) {
      const uploadForm = new FormData();
      uploadForm.append('file', item.photoFile);
      uploadForm.append('folder', 'damage');
      const uploadRes = await fetch('/api/upload-to-drive', { method: 'POST', body: uploadForm });
      const uploadData = await uploadRes.json();
      if (!uploadData.success) {
        return { success: false, error: `อัปโหลดรูปไม่สำเร็จ: ${uploadData.error}` };
      }
      damage_image_url = uploadData.data.viewLink;
    }

    const res = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...item.form, damage_image_url, recorded_by: user?.id }),
    });
    const data = await res.json();
    return data.success
      ? { success: true, running_no: data.data.running_no }
      : { success: false, error: data.error || 'เกิดข้อผิดพลาด' };
  };

  const handleSaveAll = async () => {
    if (queue.length === 0) return;
    setSaving(true);
    setError('');
    setSuccess('');

    const results = await Promise.all(
      queue.map((item) => submitQueueItem(item).catch(() => ({ success: false, error: 'เกิดข้อผิดพลาด' })))
    );

    const succeededRunningNos: number[] = [];
    const stillPending: QueueItem[] = [];
    queue.forEach((item, i) => {
      const result = results[i];
      if (result.success) {
        succeededRunningNos.push(result.running_no!);
        if (item.photoPreview) URL.revokeObjectURL(item.photoPreview);
      } else {
        stillPending.push({ ...item, error: result.error });
      }
    });

    setQueue(stillPending);
    if (succeededRunningNos.length > 0) {
      setSuccess(`✅ บันทึกสำเร็จ ${succeededRunningNos.length} รายการ (Running No. ${succeededRunningNos.map((n) => `#${n}`).join(', ')})`);
    }
    if (stillPending.length > 0) {
      setError(`❌ บันทึกไม่สำเร็จ ${stillPending.length} รายการ — ดูรายละเอียดในตารางด้านล่างแล้วลองใหม่`);
    }
    setSaving(false);
  };

  const deptName = (id: string) => departments.find((d: any) => d.id === id)?.name || id;

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
        <form onSubmit={handleAddToQueue}>
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

          <div className="form-row">
            <div className="form-group">
              <label>เลขใบกำกับภาษี</label>
              <input type="text" value={form.tax_invoice_no} onChange={(e) => setForm({ ...form, tax_invoice_no: e.target.value })} placeholder="เลขใบกำกับภาษี" />
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
            <label>หน่วยงานผู้รับ * (เลือกได้มากกว่า 1 หน่วยงาน)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} role="group" aria-label="หน่วยงานผู้รับ">
              {departments.map((d: any) => (
                <button
                  key={d.id}
                  type="button"
                  className={`document-type-chip ${form.recipient_dept_ids.includes(d.id) ? 'active' : ''}`}
                  aria-pressed={form.recipient_dept_ids.includes(d.id)}
                  onClick={() => toggleDept(d.id)}
                >
                  {d.name} ({d.code})
                </button>
              ))}
            </div>
          </div>

          {isGoodsReceipt && (
            <div className="form-row">
              <div className="form-group">
                <label>ผู้ตรวจสอบ</label>
                <input
                  type="text"
                  value={form.inspector_signature}
                  onChange={(e) => setForm({ ...form, inspector_signature: e.target.value })}
                  placeholder="ชื่อ/ลายเซ็นผู้ตรวจสอบ"
                />
              </div>
              <div className="form-group">
                <label>จัดซื้อ</label>
                <input
                  type="text"
                  value={form.purchasing_signature}
                  onChange={(e) => setForm({ ...form, purchasing_signature: e.target.value })}
                  placeholder="ชื่อ/ลายเซ็นจัดซื้อ"
                />
              </div>
            </div>
          )}

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

          <button type="submit" className="secondary-button" style={{ marginTop: 8 }}>
            ➕ เพิ่มเข้ารายการที่รอบันทึก
          </button>
        </form>
      </div>

      {queue.length > 0 && (
        <div className="scan-panel" style={{ marginTop: 16 }}>
          <div className="packer-header">
            <span className="eyebrow">📋 รายการที่รอบันทึก ({queue.length} รายการ)</span>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>วันที่รับ</th>
                  <th>เลขที่เอกสาร</th>
                  <th>ผู้ส่ง</th>
                  <th>เรื่อง</th>
                  <th>หน่วยงาน</th>
                  <th>ลบ</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((item) => (
                  <tr key={item.id}>
                    <td>{item.form.received_date}</td>
                    <td>{item.form.doc_number || '-'}</td>
                    <td>{item.form.sender}</td>
                    <td>{item.form.subject}</td>
                    <td>{item.form.recipient_dept_ids.map(deptName).join(', ')}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => handleRemoveFromQueue(item.id)}
                        style={{ background: 'var(--danger)', color: 'white', border: 'none', padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: '0.8rem' }}
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {queue.some((q) => q.error) && (
            <div style={{ marginTop: 10, display: 'grid', gap: 4 }}>
              {queue.filter((q) => q.error).map((q) => (
                <div key={q.id} className="toast error" style={{ position: 'static' }}>
                  {q.form.sender} — {q.error}
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            className="secondary-button"
            onClick={handleSaveAll}
            disabled={saving}
            style={{ marginTop: 12 }}
          >
            {saving ? 'กำลังบันทึก...' : `💾 บันทึกทั้งหมด (${queue.length})`}
          </button>
        </div>
      )}
    </div>
  );
}
