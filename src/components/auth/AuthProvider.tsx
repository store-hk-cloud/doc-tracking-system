'use client';

import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { Profile } from '@/types';

interface AuthContextType {
  user: { id: string; email: string } | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  signIn: async () => null,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    let mounted = true;

    // Get initial session - this is the ONLY place we set user/profile
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email! });
        // Load profile via API route (service_role bypasses RLS)
        try {
          const res = await fetch('/api/profile');
          if (res.ok) {
            const data = await res.json();
            if (mounted && data.success) setProfile(data.data);
          }
        } catch (_) {}
      }
      if (mounted) setLoading(false);
    });

    // Subscribe only for sign-out events
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'SIGNED_OUT') {
        setUser(null);
        setProfile(null);
      }
      // NO setUser on SIGNED_IN - that causes infinite loops
    });

    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  const signIn = async (email: string, password: string): Promise<string | null> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return error.message;
    // Reload the page to get fresh session
    window.location.href = '/dashboard';
    return null;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/';
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
