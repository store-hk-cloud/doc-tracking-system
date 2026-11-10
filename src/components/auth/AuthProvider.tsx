'use client';

import { createClient } from '@/lib/supabase/client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { Profile } from '@/types';

interface AuthContextType {
  user: { id: string; email: string } | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signInWithUsername: (username: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  signIn: async () => null,
  signInWithUsername: async () => null,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [supabase] = useState(createClient);

  useEffect(() => {
    let mounted = true;
    let signedOut = false;

    // Get initial session - this is the ONLY place we set user/profile
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted || signedOut) return;
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email! });
        // Load profile via API route (service_role bypasses RLS)
        try {
          const res = await fetch('/api/profile');
          if (res.ok) {
            const data = await res.json();
            if (mounted && !signedOut && data.success) setProfile(data.data);
          }
        } catch {}
      }
      if (mounted) setLoading(false);
    }).catch(() => {
      if (mounted) setLoading(false);
    });

    // Subscribe only for sign-out events
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (!mounted) return;
      if (event === 'SIGNED_OUT') {
        signedOut = true;
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
      // NO setUser on SIGNED_IN - that causes infinite loops
    });

    return () => { mounted = false; subscription.unsubscribe(); };
  }, [supabase]);

  const signIn = async (email: string, password: string): Promise<string | null> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return error.message;
    // Reload the page to get fresh session
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- ต้องโหลด AuthProvider ใหม่เพื่ออ่าน session/profile หลังเข้าสู่ระบบ
    window.location.href = '/dashboard';
    return null;
  };

  const signInWithUsername = async (username: string, password: string): Promise<string | null> => {
    try {
      const response = await fetch('/api/auth/resolve-username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json();
      const accessToken = result?.data?.access_token;
      const refreshToken = result?.data?.refresh_token;

      if (!response.ok || result?.success !== true || typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
        return 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
      }

      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) return 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';

      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- ต้องโหลด AuthProvider ใหม่เพื่ออ่าน session/profile หลังเข้าสู่ระบบ
      window.location.href = '/dashboard';
      return null;
    } catch {
      return 'เชื่อมต่อไม่สำเร็จ กรุณาลองอีกครั้ง';
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut({ scope: 'local' });
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- โหลดใหม่เพื่อล้าง state และข้อมูลหน้าที่ป้องกันด้วย session
    window.location.href = '/';
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signInWithUsername, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
