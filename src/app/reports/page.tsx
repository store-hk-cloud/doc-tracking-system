'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { documentNo } from '@/lib/document-no';

// วันที่ของเครื่องผู้ใช้ (อยู่ไทย) — toISOString() ให้วันที่ UTC ซึ่งเป็น "เมื่อวาน"
// ตลอดช่วง 00:00-06:59 ตามเวลาไทย ทำให้ชื่อไฟล์รายงานลงวันที่ผิด
const pad = (n: number) => String(n).padStart(2, '0');
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export default function ReportsPage() {
  const { profile } = useAuth();
  const [departments, setDepartments] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'admin';

  const [filters, setFilters] = useState({
    date_from: '',
    date_to: '',
    sender: '',
    dept_id: '',
    status: '',
  });

  useEffect(() => {
    fetch('/api/departments').then(r => r.json()).then(data => {
      if (data.success) setDepartments(data.data);
    });
  }, []);

  const handleSearch = async () => {
    setLoading(true);
    setSearched(true);
    let url = '/api/documents?';
    if (filters.date_from) url += `date_from=${filters.date_from}&`;
    if (filters.date_to) url += `date_to=${filters.date_to}&`;
    if (filters.sender) url += `keyword=${encodeURIComponent(filters.sender)}&`;
    if (filters.dept_id) url += `dept_id=${filters.dept_id}&`;
    if (filters.status) url += `status=${filters.status}&`;
    // API กรองสิทธิ์ตาม workflow กลางของใบรับสินค้าอยู่แล้ว.

    // ล้างผลเดิมและรายงาน error เสมอ — เดิมถ้าค้นไม่สำเร็จจะไม่แตะ docs
    // ผู้ใช้จึงเห็นผลของการค้นครั้งก่อนค้างอยู่เหมือนเป็นผลของเงื่อนไขใหม่
    try {
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        setDocs(data.data);
        setError('');
      } else {
        setDocs([]);
        setError(data?.error || `ค้นหาไม่สำเร็จ (HTTP ${res.status})`);
      }
    } catch (e: any) {
      setDocs([]);
      setError(e?.message || 'ค้นหาไม่สำเร็จ');
    }
    setLoading(false);
  };

  const escapeCsvCell = (value: any) => {
    const s = String(value ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const exportCSV = () => {
    const headers = ['เลขที่รับเข้า', 'วันที่รับ', 'เลขที่เอกสาร', 'เลขใบกำกับภาษี', 'ผู้ส่ง', 'เรื่อง', 'หน่วยงาน', 'สถานะ'];
    const rows = docs.map((d: any) => [
      documentNo(d), d.received_date, d.doc_number || '', d.tax_invoice_no || '', d.sender, d.subject,
      d.recipient_dept_name, d.status,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    // ต้อง revoke ทุกครั้ง ไม่งั้น blob ค้างในหน่วยความจำตลอดอายุของหน้า
    // กด export หลายรอบก็สะสมไปเรื่อย ๆ
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `report_${todayLocal()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const statusLabels: Record<string, string> = {
    registered: 'ลงทะเบียน', delivered: 'ส่งมอบแล้ว', awaiting_inspector: 'รอผู้ตรวจสอบ', awaiting_purchasing: 'รอจัดซื้อ', awaiting_recipient: 'รอผู้รับ', signed: 'ลงนามแล้ว', closed: 'ปิดงานแล้ว', rejected: 'แจ้งปัญหา',
  };

  return (
    <div>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="title-badge">📈 รายงาน</div>
        <h2>รายงานและค้นหาขั้นสูง</h2>
        <div className="title-accent" />
      </div>

      <div className="scan-panel">
        <div className="report-controls">
          <div className="field-control">
            <span>📅 ช่วงวันที่</span>
            <div className="range-fields">
              <input type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} />
              <input type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} />
            </div>
          </div>
          <div className="field-control">
            <span>🔍 ผู้ส่ง</span>
            <input type="text" value={filters.sender} onChange={(e) => setFilters({ ...filters, sender: e.target.value })} placeholder="ชื่อผู้ส่ง" />
          </div>
          {isAdmin && (
            <div className="field-control">
              <span>🏢 หน่วยงาน</span>
              <select value={filters.dept_id} onChange={(e) => setFilters({ ...filters, dept_id: e.target.value })}>
                <option value="">ทั้งหมด</option>
                {departments.map((d: any) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}
          <button className="secondary-button" onClick={handleSearch} style={{ minHeight: 44, alignSelf: 'end' }}>
            🔍 ค้นหา
          </button>
        </div>
      </div>

      {docs.length > 0 && (
        <>
          <div className="report-summary" style={{ marginTop: 16 }}>
            <div>
              <span>📄 จำนวนเอกสาร</span>
              <strong>{docs.length}</strong>
            </div>
            <div>
              <span>📝 รอส่งมอบ</span>
              <strong>{docs.filter((d: any) => d.status === 'registered').length}</strong>
            </div>
            <div>
              <span>✅ ปิดงานแล้ว</span>
              <strong>{docs.filter((d: any) => d.status === 'closed').length}</strong>
            </div>
          </div>

          <div className="report-panel">
            <div className="recent-header">
              <h3>ผลลัพธ์</h3>
              <div className="recent-actions">
                <button className="ghost-button" onClick={exportCSV} style={{ width: 'auto', padding: '0 16px', minHeight: 38 }}>
                  📥 Export CSV
                </button>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>วันที่รับ</th>
                    <th>เลขที่</th>
                    <th>ผู้ส่ง</th>
                    <th>เรื่อง</th>
                    <th>หน่วยงาน</th>
                    <th>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((doc: any) => (
                    <tr key={doc.id}>
                      <td className="code-cell">{documentNo(doc)}</td>
                      <td>{doc.received_date}</td>
                      <td>{doc.doc_number || '-'}</td>
                      <td>{doc.sender}</td>
                      <td>{doc.subject}</td>
                      <td>{doc.recipient_dept_name}</td>
                      <td><span className={`status-badge${doc.status === 'closed' ? ' success' : doc.status === 'rejected' ? ' error' : ''}`}>{statusLabels[doc.status] || doc.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {error && (
        <div className="toast error" style={{ position: 'static', marginTop: 16 }}>
          {error}
        </div>
      )}

      {loading && (
        <div className="empty-search" style={{ marginTop: 16 }}>
          กำลังค้นหา...
        </div>
      )}

      {/* แยกสองกรณีให้ชัด เดิมค้นแล้วไม่เจอก็ยังขึ้นว่า "กรุณากดค้นหา"
          ซึ่งบอกให้ผู้ใช้ทำสิ่งที่เพิ่งทำไปแล้ว */}
      {!loading && !error && docs.length === 0 && (
        <div className="empty-search" style={{ marginTop: 16 }}>
          {searched ? 'ไม่พบเอกสารที่ตรงกับเงื่อนไขที่เลือก' : 'กรุณากด "ค้นหา" เพื่อแสดงผลลัพธ์'}
        </div>
      )}
    </div>
  );
}
