'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';

export default function ReportsPage() {
  const { profile } = useAuth();
  const [departments, setDepartments] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
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
    let url = '/api/documents?';
    if (filters.date_from) url += `date_from=${filters.date_from}&`;
    if (filters.date_to) url += `date_to=${filters.date_to}&`;
    if (filters.sender) url += `keyword=${encodeURIComponent(filters.sender)}&`;
    if (filters.dept_id) url += `dept_id=${filters.dept_id}&`;
    if (filters.status) url += `status=${filters.status}&`;
    if (!isAdmin && profile?.department_id) url += `dept_id=${profile.department_id}&`;

    const res = await fetch(url);
    const data = await res.json();
    if (data.success) setDocs(data.data);
    setLoading(false);
  };

  const exportCSV = () => {
    const headers = ['Running No.', 'วันที่รับ', 'เลขที่เอกสาร', 'ผู้ส่ง', 'เรื่อง', 'หน่วยงาน', 'สถานะ'];
    const rows = docs.map((d: any) => [
      d.running_no, d.received_date, d.doc_number || '', d.sender, d.subject,
      d.recipient_dept_name, d.status,
    ]);
    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `report_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const statusLabels: Record<string, string> = {
    registered: 'ลงทะเบียน', delivered: 'ส่งมอบแล้ว', signed: 'ลงนามแล้ว', closed: 'ปิดงานแล้ว', rejected: 'แจ้งปัญหา',
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
                      <td className="code-cell">{doc.running_no}</td>
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

      {!loading && docs.length === 0 && (
        <div className="empty-search" style={{ marginTop: 16 }}>
          กรุณากด "ค้นหา" เพื่อแสดงผลลัพธ์
        </div>
      )}
    </div>
  );
}