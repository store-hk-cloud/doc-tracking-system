'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { createClient } from '@/lib/supabase/client';
import { ACCOUNTING_DESTINATION_CODES, accountingDestinationFor, isGoodsReceipt } from '@/lib/document-workflow';
import { documentNo } from '@/lib/document-no';

const DOCUMENT_TYPES = [
  'จดหมาย', 'ใบกำกับภาษี', 'ใบวางบิล', 'พัสดุ', 'ใบเสร็จ', 'บิลต่างๆ',
  'ใบเบิก', 'ใบรับสินค้าสำเร็จรูป', 'ใบรับสินค้า', 'ใบโอนสินค้า', 'เอกสารอื่นๆ',
];
// กฎว่าเรื่องไหนต้องส่งถึงบัญชี และ "บัญชี" หน่วยงานไหน อยู่ที่ document-workflow.ts
// ที่เดียว ห้ามถือสำเนาไว้ที่นี่: สำเนาชุดเดิมทำให้ใบเบิกถูกล็อกไปที่ 0-ADM03
// ทั้งที่ต้องเป็น 0-ADM03-1 และแก้ที่เดียวไม่พอเพราะ API ก็มีสำเนาของตัวเอง
function isAccountingOnlyDocument(subject: string) {
  return accountingDestinationFor(subject) !== null;
}

function isGoodsReceiptDocument(subject: string) {
  return isGoodsReceipt(subject.trim());
}

function emptyRow() {
  return {
    id: crypto.randomUUID(),
    received_date: new Date().toISOString().split('T')[0],
    doc_number: '',
    tax_invoice_no: '',
    sender: '',
    subject: '',
    recipient_dept_ids: [] as string[],
    note: '',
    is_damaged: false,
    photoFile: null as File | null,
    photoPreview: '',
    error: undefined as string | undefined,
  };
}

type Row = ReturnType<typeof emptyRow>;

export default function RegisterPage() {
  const { user } = useAuth();
  const supabase = createClient();
  const [departments, setDepartments] = useState<any[]>([]);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [deptPopupRowId, setDeptPopupRowId] = useState<string | null>(null);
  const [detailsPopupRowId, setDetailsPopupRowId] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('departments').select('*').order('name').then(({ data }) => {
      if (data) setDepartments(data);
    });
  }, []);

  /** หน่วยงานบัญชีที่ต้องเป็นปลายทางของเรื่องนี้ — undefined ถ้าเรื่องนี้เลือกได้อิสระ */
  const accountingDepartmentFor = (subject: string) => {
    const code = accountingDestinationFor(subject);
    if (!code) return undefined;
    return departments.find((department: any) => department.code === code);
  };

  // ถ้าผู้ใช้เลือกประเภทเอกสารก่อนข้อมูลหน่วยงานโหลดเสร็จ ให้เพิ่มฝ่ายบัญชี
  // ทันทีที่มีข้อมูล โดย API จะบังคับซ้ำอีกชั้นเพื่อความปลอดภัย
  useEffect(() => {
    if (departments.length === 0) return;
    setRows((current) => current.map((row) => {
      const accountingDepartment = accountingDepartmentFor(row.subject);
      if (!accountingDepartment) return row;
      return {
        ...row,
        recipient_dept_ids: [
          accountingDepartment.id,
          ...row.recipient_dept_ids.filter((departmentId) => departmentId !== accountingDepartment.id),
        ],
      };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departments]);

  useEffect(() => {
    return () => {
      rows.forEach((r) => { if (r.photoPreview) URL.revokeObjectURL(r.photoPreview); });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateRow = (id: string, patch: Partial<Row>) => {
    setRows((current) => current.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const updateSubject = (id: string, subject: string) => {
    const accountingDepartment = accountingDepartmentFor(subject);
    // เปลี่ยนเรื่องแล้วต้องถอนบัญชีปลายทางของเรื่องเดิมออกด้วย ไม่ใช่แค่เพิ่มของใหม่
    // (เช่น เลือกใบรับสินค้าแล้วเปลี่ยนเป็นใบเบิก 0-ADM03 ต้องหลุดไป ไม่ค้างอยู่)
    const staleAccountingIds = new Set(
      departments
        .filter((department: any) => ACCOUNTING_DESTINATION_CODES.has(department.code))
        .filter((department: any) => department.id !== accountingDepartment?.id)
        .map((department: any) => department.id)
    );
    setRows((current) => current.map((row) => {
      if (row.id !== id) return row;
      const kept = row.recipient_dept_ids.filter((departmentId) => !staleAccountingIds.has(departmentId));
      return {
        ...row,
        subject,
        recipient_dept_ids: accountingDepartment
          ? [accountingDepartment.id, ...kept.filter((departmentId) => departmentId !== accountingDepartment.id)]
          : kept,
      };
    }));
  };

  const addRow = () => setRows((current) => [...current, emptyRow()]);

  const removeRow = (id: string) => {
    setRows((current) => {
      const row = current.find((r) => r.id === id);
      if (row?.photoPreview) URL.revokeObjectURL(row.photoPreview);
      return current.filter((r) => r.id !== id);
    });
  };

  const toggleDept = (rowId: string, deptId: string) => {
    setRows((current) => current.map((r) => (
      r.id === rowId
        ? deptId === accountingDepartmentFor(r.subject)?.id
          ? r
          : { ...r, recipient_dept_ids: r.recipient_dept_ids.includes(deptId) ? r.recipient_dept_ids.filter((id) => id !== deptId) : [...r.recipient_dept_ids, deptId] }
        : r
    )));
  };

  const clearRowPhoto = (id: string) => {
    const row = rows.find((r) => r.id === id);
    if (row?.photoPreview) URL.revokeObjectURL(row.photoPreview);
    updateRow(id, { photoFile: null, photoPreview: '' });
  };

  const handlePhotoChange = (rowId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const row = rows.find((r) => r.id === rowId);
    if (row?.photoPreview) URL.revokeObjectURL(row.photoPreview);
    updateRow(rowId, { photoFile: file, photoPreview: URL.createObjectURL(file) });
  };

  const handleShareLine = async (row: Row) => {
    if (!row.photoFile) return;
    const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
    if (!nav.share || !nav.canShare || !nav.canShare({ files: [row.photoFile] })) {
      setError('อุปกรณ์นี้ไม่รองรับการแชร์รูปโดยตรง กรุณาบันทึกรูปแล้วแชร์ผ่านแอป LINE เอง');
      return;
    }
    setSharing(true);
    try {
      await nav.share({
        files: [row.photoFile],
        title: 'รูปความเสียหาย',
        text: `พัสดุ/เอกสารเสียหาย: ${row.subject || ''} (${row.sender || ''})`,
      });
    } catch (err: any) {
      if (err?.name !== 'AbortError') setError('แชร์รูปไม่สำเร็จ');
    }
    setSharing(false);
  };

  const submitRow = async (row: Row) => {
    let damage_image_url = '';
    if (row.is_damaged && row.photoFile) {
      const uploadForm = new FormData();
      uploadForm.append('file', row.photoFile);
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
      body: JSON.stringify({
        received_date: row.received_date,
        doc_number: row.doc_number,
        tax_invoice_no: row.tax_invoice_no,
        sender: row.sender,
        subject: row.subject,
        // API เป็นผู้บังคับปลายทางฝ่ายบัญชีอีกชั้นหนึ่ง แม้มีการแก้ request โดยตรง
        recipient_dept_ids: row.recipient_dept_ids,
        note: row.note,
        is_damaged: row.is_damaged,
        damage_image_url,
        recorded_by: user?.id,
      }),
    });
    const data = await res.json();
    return data.success
      ? { success: true, display_no: documentNo(data.data) }
      : { success: false, error: data.error || 'เกิดข้อผิดพลาด' };
  };

  const handleSaveAll = async () => {
    setError('');
    setSuccess('');

    const validRows: Row[] = [];
    const invalidIds = new Set<string>();
    setRows((current) => current.map((r) => {
      if (!r.sender || !r.subject || (!isAccountingOnlyDocument(r.subject) && r.recipient_dept_ids.length === 0)) {
        invalidIds.add(r.id);
        return { ...r, error: 'กรุณากรอกผู้ส่ง, เรื่อง และเลือกหน่วยงานอย่างน้อย 1 หน่วยงาน' };
      }
      return { ...r, error: undefined };
    }));
    rows.forEach((r) => { if (!invalidIds.has(r.id)) validRows.push(r); });

    if (validRows.length === 0) {
      setError('กรุณากรอกข้อมูลที่จำเป็นให้ครบอย่างน้อย 1 แถวก่อนบันทึก');
      return;
    }

    setSaving(true);
    const results = await Promise.all(
      validRows.map((row) => submitRow(row).catch(() => ({ success: false, error: 'เกิดข้อผิดพลาด' })))
    );

    const succeededNos: string[] = [];
    const failedIds = new Map<string, string>();
    validRows.forEach((row, i) => {
      const result = results[i];
      if (result.success) {
        succeededNos.push(result.display_no!);
        if (row.photoPreview) URL.revokeObjectURL(row.photoPreview);
      } else {
        failedIds.set(row.id, result.error || 'เกิดข้อผิดพลาด');
      }
    });

    setRows((current) => {
      const remaining = current
        .filter((r) => !(validRows.some((v) => v.id === r.id) && !failedIds.has(r.id)))
        .map((r) => (failedIds.has(r.id) ? { ...r, error: failedIds.get(r.id) } : r));
      return remaining.length > 0 ? remaining : [emptyRow()];
    });

    if (succeededNos.length > 0) {
      setSuccess(`✅ บันทึกสำเร็จ ${succeededNos.length} รายการ (เลขที่ ${succeededNos.join(', ')})`);
    }
    if (failedIds.size > 0 || invalidIds.size > 0) {
      setError(`❌ บันทึกไม่สำเร็จ ${failedIds.size + invalidIds.size} รายการ — ดูรายละเอียดในตารางแล้วลองใหม่`);
    }
    setSaving(false);
  };

  const deptPopupRow = rows.find((r) => r.id === deptPopupRowId);
  const detailsPopupRow = rows.find((r) => r.id === detailsPopupRowId);
  const hasExtraDetails = (row: Row) =>
    !!(row.tax_invoice_no || row.note || row.is_damaged);

  return (
    <div>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="title-badge">📝 ลงทะเบียน</div>
        <h2>ลงทะเบียนเอกสารเข้า</h2>
        <div className="title-accent" />
      </div>

      {success && <div className="toast success" style={{ position: 'static', marginBottom: 12 }}>{success}</div>}
      {error && <div className="toast error" style={{ position: 'static', marginBottom: 12 }}>{error}</div>}

      <datalist id="document-types">
        {DOCUMENT_TYPES.map((type) => <option key={type} value={type} />)}
      </datalist>

      <div className="scan-panel">
        <div className="packer-header">
          <span className="eyebrow">📋 รายการเอกสาร ({rows.length} แถว)</span>
        </div>

        <div className="table-wrap no-scroll-box">
          <table>
            <thead>
              <tr>
                <th>วันที่รับ</th>
                <th>เลขที่เอกสาร</th>
                <th>ผู้ส่ง *</th>
                <th>เรื่อง *</th>
                <th>หน่วยงาน *</th>
                <th>เพิ่มเติม</th>
                <th>ลบ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <input type="date" value={row.received_date} onChange={(e) => updateRow(row.id, { received_date: e.target.value })} style={{ minWidth: 130 }} />
                  </td>
                  <td>
                    <input type="text" value={row.doc_number} onChange={(e) => updateRow(row.id, { doc_number: e.target.value })} placeholder="เช่น INV-2024-001" style={{ minWidth: 120 }} />
                  </td>
                  <td>
                    <input type="text" value={row.sender} onChange={(e) => updateRow(row.id, { sender: e.target.value })} placeholder="ชื่อผู้ส่ง / บริษัท" style={{ minWidth: 140 }} />
                  </td>
                  <td>
                    <input type="text" list="document-types" value={row.subject} onChange={(e) => updateSubject(row.id, e.target.value)} placeholder="หัวข้อเอกสาร" style={{ minWidth: 140 }} />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ghost-button"
                      style={{ width: 'auto', padding: '0 12px', whiteSpace: 'nowrap' }}
                      onClick={() => setDeptPopupRowId(row.id)}
                    >
                      🏢 {isGoodsReceiptDocument(row.subject)
                        ? `กำกับ (${row.recipient_dept_ids.length}) · ปลายทางบัญชี`
                        : isAccountingOnlyDocument(row.subject)
                          ? `เลือกแล้ว (${row.recipient_dept_ids.length}) · มีบัญชี`
                        : row.recipient_dept_ids.length > 0 ? `เลือกแล้ว (${row.recipient_dept_ids.length})` : 'เลือกหน่วยงาน'}
                    </button>
                  </td>
                  <td>
                    <button type="button" className="ghost-button" style={{ width: 'auto', padding: '0 12px', whiteSpace: 'nowrap' }} onClick={() => setDetailsPopupRowId(row.id)}>
                      {hasExtraDetails(row) ? '📎 มีข้อมูล' : '📎 ระบุ'}
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
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

        {rows.some((r) => r.error) && (
          <div style={{ marginTop: 10, display: 'grid', gap: 4 }}>
            {rows.filter((r) => r.error).map((r) => (
              <div key={r.id} className="toast error" style={{ position: 'static' }}>
                {r.sender || '(ไม่มีชื่อผู้ส่ง)'} — {r.error}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className="ghost-button" style={{ width: 'auto', padding: '0 20px' }} onClick={addRow}>
            + เพิ่มแถว
          </button>
          <button type="button" className="secondary-button" style={{ width: 'auto', padding: '0 20px' }} onClick={handleSaveAll} disabled={saving}>
            {saving ? 'กำลังบันทึก...' : `💾 บันทึกทั้งหมด (${rows.length})`}
          </button>
        </div>
      </div>

      {/* Department picker popup */}
      {deptPopupRow && (
        <div className="scan-popup-overlay" onClick={() => setDeptPopupRowId(null)}>
          <div className="scan-popup-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500, margin: '0 auto' }}>
            <div className="scan-popup-handle" />
            <h3 style={{ marginBottom: 12 }}>🏢 {isGoodsReceiptDocument(deptPopupRow.subject) ? 'เลือกหน่วยงานกำกับเอกสาร' : 'เลือกหน่วยงานผู้รับ (เลือกได้มากกว่า 1)'}</h3>
            {isAccountingOnlyDocument(deptPopupRow.subject) && (
              <div className="issue-bar" style={{ marginBottom: 12 }}>
                {isGoodsReceiptDocument(deptPopupRow.subject)
                  ? 'ใบรับสินค้าส่งถึง ACC/บัญชี เป็นปลายทางเดียว โดยหน่วยงานที่เลือกเพิ่มใช้กำกับเอกสารเท่านั้น'
                  : `เอกสารประเภทนี้ต้องส่งถึง ${accountingDepartmentFor(deptPopupRow.subject)?.name || 'บัญชี'} เสมอ และเลือกหน่วยงานอื่นเพิ่มได้`}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} role="group" aria-label={isGoodsReceiptDocument(deptPopupRow.subject) ? 'หน่วยงานกำกับเอกสาร' : 'หน่วยงานผู้รับ'}>
              {departments.map((d: any) => (
                <button
                  key={d.id}
                  type="button"
                  className={`document-type-chip ${deptPopupRow.recipient_dept_ids.includes(d.id) ? 'active' : ''}`}
                  aria-pressed={deptPopupRow.recipient_dept_ids.includes(d.id)}
                  onClick={() => toggleDept(deptPopupRow.id, d.id)}
                  disabled={d.code === accountingDestinationFor(deptPopupRow.subject)}
                >
                  {d.name} ({d.code})
                </button>
              ))}
            </div>
            <button className="secondary-button" onClick={() => setDeptPopupRowId(null)} style={{ marginTop: 16 }}>
              ✅ เสร็จสิ้น
            </button>
            <button className="scan-popup-close" onClick={() => setDeptPopupRowId(null)}>ปิด</button>
          </div>
        </div>
      )}

      {/* Extra details popup: tax invoice no., note, damage + photo */}
      {detailsPopupRow && (
        <div className="scan-popup-overlay" onClick={() => setDetailsPopupRowId(null)}>
          <div className="scan-popup-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500, margin: '0 auto' }}>
            <div className="scan-popup-handle" />
            <h3 style={{ marginBottom: 12 }}>📎 รายละเอียดเพิ่มเติม — {detailsPopupRow.sender || '(ยังไม่ระบุผู้ส่ง)'}</h3>

            <div className="form-group">
              <label>เลขใบกำกับภาษี</label>
              <input
                type="text"
                value={detailsPopupRow.tax_invoice_no}
                onChange={(e) => updateRow(detailsPopupRow.id, { tax_invoice_no: e.target.value })}
                placeholder="เลขใบกำกับภาษี"
              />
            </div>

            <div className="form-group">
              <label>หมายเหตุ</label>
              <textarea value={detailsPopupRow.note} onChange={(e) => updateRow(detailsPopupRow.id, { note: e.target.value })} placeholder="หมายเหตุเพิ่มเติม..." />
            </div>

            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="checkbox"
                id={`is_damaged_${detailsPopupRow.id}`}
                checked={detailsPopupRow.is_damaged}
                onChange={(e) => {
                  const checked = e.target.checked;
                  updateRow(detailsPopupRow.id, { is_damaged: checked });
                  if (!checked) clearRowPhoto(detailsPopupRow.id);
                }}
                style={{ width: 20, height: 20 }}
              />
              <label htmlFor={`is_damaged_${detailsPopupRow.id}`} style={{ margin: 0 }}>พัสดุ/เอกสารเสียหาย (ถ่ายรูปไว้ใน Google Drive)</label>
            </div>

            {detailsPopupRow.is_damaged && (
              <div className="form-group">
                <label>รูปความเสียหาย</label>
                {!detailsPopupRow.photoPreview ? (
                  <label
                    htmlFor={`damage_photo_${detailsPopupRow.id}`}
                    className="ghost-button"
                    style={{ display: 'inline-flex', width: 'auto', padding: '0 20px', cursor: 'pointer' }}
                  >
                    📷 ถ่ายรูป / เลือกรูป
                  </label>
                ) : (
                  <div style={{ display: 'grid', gap: 10 }}>
                    <img
                      src={detailsPopupRow.photoPreview}
                      alt="รูปความเสียหาย"
                      style={{ maxWidth: 220, borderRadius: 8, border: '1px solid var(--line)' }}
                    />
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => handleShareLine(detailsPopupRow)}
                        disabled={sharing}
                        style={{ width: 'auto', padding: '0 16px' }}
                      >
                        {sharing ? 'กำลังแชร์...' : '📤 แชร์ไลน์'}
                      </button>
                      <label
                        htmlFor={`damage_photo_${detailsPopupRow.id}`}
                        className="ghost-button"
                        style={{ display: 'inline-flex', width: 'auto', padding: '0 16px', cursor: 'pointer' }}
                      >
                        🔄 ถ่ายใหม่
                      </label>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => clearRowPhoto(detailsPopupRow.id)}
                        style={{ width: 'auto', padding: '0 16px' }}
                      >
                        🗑 ลบรูป
                      </button>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                      รูปจะถูกเก็บไว้ชั่วคราวในเครื่องระหว่างทำรายการนี้เท่านั้น ไม่ถูกบันทึกลงเครื่อง — เมื่อกดบันทึกทั้งหมด รูปจะถูกอัปโหลดขึ้น Google Drive โดยตรง
                    </div>
                  </div>
                )}
                <input
                  id={`damage_photo_${detailsPopupRow.id}`}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => handlePhotoChange(detailsPopupRow.id, e)}
                  style={{ display: 'none' }}
                />
              </div>
            )}

            <button className="secondary-button" onClick={() => setDetailsPopupRowId(null)} style={{ marginTop: 8 }}>
              ✅ เสร็จสิ้น
            </button>
            <button className="scan-popup-close" onClick={() => setDetailsPopupRowId(null)}>ปิด</button>
          </div>
        </div>
      )}
    </div>
  );
}
