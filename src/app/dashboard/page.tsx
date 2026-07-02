'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { createClient } from '@/lib/supabase/client';

export default function DashboardPage() {
  const { profile } = useAuth();
  const supabase = createClient();
  const [stats, setStats] = useState<any>(null);
  const [recentDocs, setRecentDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);

    // Get documents
    const { data: docs } = await supabase
      .from('documents')
      .select('*, departments(name)')
      .order('created_at', { ascending: false })
      .limit(10);

    if (docs) setRecentDocs(docs);

    // Get stats
    const { data: all } = await supabase.from('documents').select('status, is_damaged');
    const today = new Date().toISOString().split('T')[0];
    const { data: todayDocs } = await supabase
      .from('documents')
      .select('id')
      .gte('received_date', today);

    if (all) {
      setStats({
        total: all.length,
        today: todayDocs?.length || 0,
        registered: all.filter((d: any) => d.status === 'registered').length,
        delivered: all.filter((d: any) => d.status === 'delivered').length,
        signed: all.filter((d: any) => d.status === 'signed').length,
        closed: all.filter((d: any) => d.status === 'closed').length,
        rejected: all.filter((d: any) => d.status === 'rejected').length,
        damaged: all.filter((d: any) => d.is_damaged).length,
      });
    }

    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const statusMap: Record<string, { label: string; color: string }> = {
    registered: { label: 'ลงทะเบียน', color: '' },
    delivered: { label: 'ส่งมอบแล้ว', color: ' success' },
    signed: { label: 'ลงนามแล้ว', color: ' success' },
    closed: { label: 'ปิดงานแล้ว', color: ' success' },
    rejected: { label: 'แจ้งปัญหา', color: ' error' },
  };

  return (
    <div>
      <div className="app-title" style={{ marginBottom: 20 }}>
        <div className="title-badge">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="20" height="18" rx="2" />
            <path d="M12 3v18M6 9h4M6 13h4" />
          </svg>
          DASHBOARD
        </div>
        <h1>ภาพรวมระบบรับ-ส่งเอกสาร</h1>
        <div className="title-accent" />
      </div>

      {/* Stats */}
      <div className="metric-row">
        {loading ? (
          Array(4).fill(0).map((_, i) => (
            <div key={i}><span>กำลังโหลด...</span><strong>—</strong></div>
          ))
        ) : (
          <>
            <div>
              <span>📄 เอกสารทั้งหมด</span>
              <strong className="counter-pop">{stats?.total || 0}</strong>
            </div>
            <div>
              <span>📅 วันนี้</span>
              <strong className="counter-pop">{stats?.today || 0}</strong>
            </div>
            <div>
              <span>📝 รอส่งมอบ</span>
              <strong className="counter-pop">{stats?.registered || 0}</strong>
            </div>
            <div>
              <span>✅ ปิดงานแล้ว</span>
              <strong className="counter-pop">{stats?.closed || 0}</strong>
            </div>
            <div>
              <span>📦 ส่งมอบแล้ว</span>
              <strong className="counter-pop">{stats?.delivered || 0}</strong>
            </div>
            <div>
              <span>✍️ ลงนามแล้ว</span>
              <strong className="counter-pop">{stats?.signed || 0}</strong>
            </div>
            <div>
              <span>⚠️ แจ้งปัญหา</span>
              <strong className="counter-pop">{stats?.rejected || 0}</strong>
            </div>
            <div>
              <span>📸 เสียหาย</span>
              <strong className="counter-pop">{stats?.damaged || 0}</strong>
            </div>
          </>
        )}
      </div>

      {/* Recent */}
      <div className="recent-header">
        <h3>📋 เอกสารล่าสุด</h3>
      </div>

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
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="empty-cell">กำลังโหลด...</td></tr>
            ) : recentDocs.length === 0 ? (
              <tr><td colSpan={6} className="empty-cell">ยังไม่มีเอกสาร</td></tr>
            ) : (
              recentDocs.map((doc: any) => {
                const s = statusMap[doc.status] || { label: doc.status, color: '' };
                return (
                  <tr key={doc.id}>
                    <td className="code-cell">{doc.running_no}</td>
                    <td>{doc.received_date}</td>
                    <td>{doc.sender}</td>
                    <td>{doc.subject}</td>
                    <td>{doc.departments?.name}</td>
                    <td><span className={`status-badge${s.color}`}>{s.label}</span></td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Quick actions */}
      {profile?.role !== 'user' && (
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <a href="/register" className="secondary-button" style={{ width: 'auto', padding: '0 24px', textDecoration: 'none' }}>
            + ลงทะเบียนเอกสาร
          </a>
          <a href="/delivery" className="ghost-button" style={{ width: 'auto', padding: '0 24px', textDecoration: 'none' }}>
            📦 ไปหน้าที่ส่งมอบ
          </a>
        </div>
      )}
    </div>
  );
}