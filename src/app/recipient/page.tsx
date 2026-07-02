'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';

export default function RecipientListPage() {
  const { profile } = useAuth();
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'admin';

  useEffect(() => {
    const fetch = async () => {
      try {
        let url = '/api/documents?status=delivered&status=signed';
        if (!isAdmin && profile?.department_id) {
          url += `&dept_id=${profile.department_id}`;
        }
        const res = await fetch(url);
        const data = await res.json();
        if (data.success) {
          // Filter for delivered/signed (API supports single status, handle both)
          setDocs(data.data.filter((d: any) => ['delivered', 'signed'].includes(d.status)));
        }
      } catch (e) {
        console.error('fetch docs error:', e);
      }
      setLoading(false);
    };
    fetch();
  }, []);

  const statusMap: Record<string, { label: string; color: string }> = {
    delivered: { label: 'รอลงชื่อ', color: '' },
    signed: { label: 'ลงนามแล้ว', color: ' success' },
  };

  return (
    <div>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="title-badge">✍️ รับเอกสาร</div>
        <h2>เอกสารรอดำเนินการ</h2>
        <div className="title-accent" />
      </div>

      <div className="scan-panel">
        {loading ? (
          <div className="empty-search">กำลังโหลด...</div>
        ) : docs.length === 0 ? (
          <div className="empty-search">ไม่มีเอกสารรอดำเนินการ</div>
        ) : (
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
                  <th>ดำเนินการ</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((doc: any) => {
                  const s = statusMap[doc.status] || { label: doc.status, color: '' };
                  return (
                    <tr key={doc.id}>
                      <td className="code-cell">{doc.running_no}</td>
                      <td>{doc.received_date}</td>
                      <td>{doc.sender}</td>
                      <td>{doc.subject}</td>
                      <td>{doc.recipient_dept_name}</td>
                      <td><span className={`status-badge${s.color}`}>{s.label}</span></td>
                      <td>
                        {doc.status === 'delivered' ? (
                          <a href={`/recipient/${doc.id}`} className="table-action-button" style={{ textDecoration: 'none', display: 'inline-flex', padding: '6px 14px' }}>
                            ✍️ ลงชื่อรับ
                          </a>
                        ) : (
                          <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>รอตรวจสอบ</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}