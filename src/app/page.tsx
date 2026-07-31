'use client';

import { useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const err = await signIn(email, password);
    if (err) setError(err);
    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div className="scan-panel auth-card">
        <div className="app-title" style={{ marginBottom: 24, textAlign: 'center' }}>
          <img src="/icons/hillkoff-emblem.png" alt="Hillkoff" width={64} height={64} style={{ marginBottom: 12 }} />
          <h1 style={{ fontSize: '1.5rem' }}>จดหมาย พัสดุ เอกสารภายใน</h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: 4 }}>
            เข้าสู่ระบบเพื่อดำเนินการ
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>อีเมล</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
            />
          </div>
          <div className="form-group">
            <label>รหัสผ่าน</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <div className="toast error" style={{ position: 'static', marginBottom: 12 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="secondary-button"
            disabled={loading}
            style={{ marginTop: 8 }}
          >
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>
      </div>
    </div>
  );
}