'use client';

import Image from 'next/image';

import { useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';

type Mode = 'email' | 'username';

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('email');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signInWithUsername } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // ส่งชื่อผู้ใช้พร้อมรหัสผ่านให้ server ตรวจในคำขอเดียว เพื่อไม่ให้อีเมลของบัญชี
    // ถูก resolve และปรากฏใน browser ก่อนยืนยันตัวตนสำเร็จ
    const err = mode === 'username'
      ? await signInWithUsername(username.trim(), password)
      : await signIn(email, password);
    if (err) setError(mode === 'username' ? 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' : err);
    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div className="scan-panel auth-card">
        <div className="app-title" style={{ marginBottom: 24, textAlign: 'center' }}>
          <Image src="/icons/hillkoff-emblem.png" alt="Hillkoff" width={64} height={64} style={{ marginBottom: 12 }} />
          <h1 style={{ fontSize: '1.5rem' }}>จดหมาย พัสดุ เอกสารภายใน</h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: 4 }}>
            เข้าสู่ระบบเพื่อดำเนินการ
          </p>
        </div>

        <div className="segmented-control" style={{ marginBottom: 16 }}>
          <button
            type="button"
            className={mode === 'email' ? 'active' : ''}
            onClick={() => { setMode('email'); setError(''); }}
          >
            อีเมล
          </button>
          <button
            type="button"
            className={mode === 'username' ? 'active' : ''}
            onClick={() => { setMode('username'); setError(''); }}
          >
            ชื่อผู้ใช้
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'email' ? (
            <div className="form-group">
              <label htmlFor="login-email">อีเมล</label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                autoComplete="username"
                required
              />
            </div>
          ) : (
            <div className="form-group">
              <label htmlFor="login-username">ชื่อผู้ใช้</label>
              <input
                id="login-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="เช่น somchai"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
              />
            </div>
          )}
          <div className="form-group">
            <label htmlFor="login-password">รหัสผ่าน</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
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
