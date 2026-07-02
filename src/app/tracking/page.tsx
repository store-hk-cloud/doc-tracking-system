'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { createClient } from '@/lib/supabase/client';

const STATUS_OPTIONS = ['ทั้งหมด', 'registered', 'delivered', 'signed', 'closed', 'rejected'];
const STATUS_LABELS: Record<string, string> = {
  'ทั้งหมด': 'ทั้งหมด',
  registered: 'ลงทะเบียน',
  delivered: 'ส่งมอบแล้ว',
  signed: 'ลงนามแล้ว',
  closed: 'ปิดงานแล้ว',
  rejected: 'แจ้งปัญหา',
};
const STATUS_COLORS: Record<string, string> = {
  registered: '',
  delivered: ' success',
  signed: ' success',
  closed: ' success',
  rejected: ' error',
};

export default function TrackingPage() {
  const { profile } = useAuth();
  const supabase = createClient();
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: '', keyword: '', dept_id: '' });
  const [departments, setDepartments] = useState<any[]>([]);
  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'admin';
  const [selectedDoc, setSelectedDoc] = useState<any>(null);

  useEffect(() => {
    supabase.from('departments').select('*').order('name').then(({ data }) => {
      if (data) setDepartments(data);
    });
  }, []);

  const fetchDocs = async () => {
    setLoading(true);
    let url = '/api/documents?';
    if (filter.status) url += `status=${filter.status}&`;
    if (filter.keyword) url += `keyword=${encodeURIComponent(filter.keyword)}&`;
    if (filter.dept_id) url += `dept_id=${filter.dept_id}&`;
    if (!isAdmin && profile?.department_id) url += `dept_id=${profile.department_id}&`;

    const res = await fetch(url);
    const data = await res.json();
    if (data.success) setDocs(data.data);
    setLoading(false);
  };

  useEffect(() => { fetchDocs(); }, [filter.status]);

  return (
    <div>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="title-badge">🔍 ติดตาม</div>
        <h2>ติดตามสถานะเอกสาร</h2>
        <div className="title-accent" />
      </div>

      {/* Filters */}
      <div className="search-panel">
        <div className="search-form">
          <div className="search-input-row">
            <input
              placeholder="ค้นหา ผู้ส่ง, เรื่อง, เลขที่เอกสาร..."
              value={filter.keyword}
              onChange={(e) => setFilter({ ...filter, keyword: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && fetchDocs()}
            />
          </div>
          <div className="segmented-control" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s}
                className={filter.status === (s === 'ทั้งหมด' ? '' : s) ? 'active' : ''}
                onClick={() => setFilter({ ...filter, status: s === 'ทั้งหมด' ? '' : s })}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          {isAdmin && (
            <select value={filter.dept_id} onChange={(e) => setFilter({ ...filter, dept_id: e.target.value })} style={{ minHeight: 42, borderRadius: 8, border: '1px solid var(--line-strong)', padding: '0 10px' }}>
              <option value="">ทุกหน่วยงาน</option>
              {departments.map((d: any) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          )}
          <button className="secondary-button" onClick={fetchDocs} style={{ minHeight: 44 }}>
            🔍 ค้นหา
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="report-panel">
        {loading ? (
          <div className="empty-search">กำลังโหลด...</div>
        ) : docs.length === 0 ? (
          <div className="empty-search">ไม่พบเอกสาร</div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>วันที่รับ</th>
                    <th>ผู้ส่ง</th>
                    <th>เรื่อง</th>
                    <th>หน่วยงาน</th>
                    <th>สถานะ</th>
                    <th>ลายเซ็น Admin</th>
                    <th>ลายเซ็นผู้รับ</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((doc: any) => (
                    <tr key={doc.id} onClick={() => setSelectedDoc(doc)} style={{ cursor: 'pointer' }}>
                      <td className="code-cell">{doc.running_no}</td>
                      <td>{doc.received_date}</td>
                      <td>{doc.sender}</td>
                      <td>{doc.subject}</td>
                      <td>{doc.recipient_dept_name}</td>
                      <td>
                        <span className={`status-badge${STATUS_COLORS[doc.status] || ''}`}>
                          {STATUS_LABELS[doc.status] || doc.status}
                        </span>
                      </td>
                      <td>{doc.admin_signature || '-'}</td>
                      <td>-</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: '0.85rem', fontWeight: 700 }}>
              พบทั้งหมด {docs.length} รายการ
            </div>
          </>
        )}
      </div>

      {/* Modal */}
      {selectedDoc && (
        <div className="scan-popup-overlay" onClick={() => setSelectedDoc(null)}>
          <div className="scan-popup-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520, margin: '0 auto' }}>
            <div className="scan-popup-handle" />
            <h3 style={{ marginBottom: 12 }}>📄 รายละเอียดเอกสาร #{selectedDoc.running_no}</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              <div><strong>วันที่รับ:</strong> {selectedDoc.received_date}</div>
              <div><strong>เลขที่เอกสาร:</strong> {selectedDoc.doc_number || '-'}</div>
              <div><strong>ผู้ส่ง:</strong> {selectedDoc.sender}</div>
              <div><strong>เรื่อง:</strong> {selectedDoc.subject}</div>
              <div><strong>หน่วยงาน:</strong> {selectedDoc.recipient_dept_name}</div>
              <div><strong>สถานะ:</strong> <span className={`status-badge${STATUS_COLORS[selectedDoc.status] || ''}`}>{STATUS_LABELS[selectedDoc.status] || selectedDoc.status}</span></div>
              <div><strong>ผู้บันทึก:</strong> {selectedDoc.recorded_by_name || '-'}</div>
              {selectedDoc.admin_signature && <div><strong>ลายเซ็นส่งมอบ:</strong> {selectedDoc.admin_signature}</div>}
              {selectedDoc.note && <div><strong>หมายเหตุ:</strong> {selectedDoc.note}</div>}
            </div>
            <button className="scan-popup-close" onClick={() => setSelectedDoc(null)}>ปิด</button>
          </div>
        </div>
      )}
    </div>
  );
}