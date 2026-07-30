import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    if (typeof window !== 'undefined') {
      console.warn('⚠️ Supabase environment variables not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local or Vercel Environment Variables.');
    }
    // Return a mock client that won't crash build
    return {
      from: () => ({
        select: () => ({ data: null, error: new Error('Supabase not configured') }),
        insert: () => ({ data: null, error: new Error('Supabase not configured') }),
        update: () => ({ data: null, error: new Error('Supabase not configured') }),
        delete: () => ({ data: null, error: new Error('Supabase not configured') }),
        eq: () => ({ data: null, error: new Error('Supabase not configured') }),
        single: () => ({ data: null, error: new Error('Supabase not configured') }),
        order: () => ({ data: null, error: new Error('Supabase not configured') }),
        limit: () => ({ data: null, error: new Error('Supabase not configured') }),
        in: () => ({ data: null, error: new Error('Supabase not configured') }),
        gte: () => ({ data: null, error: new Error('Supabase not configured') }),
        lte: () => ({ data: null, error: new Error('Supabase not configured') }),
        or: () => ({ data: null, error: new Error('Supabase not configured') }),
      }),
      auth: {
        getSession: () => Promise.resolve({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signInWithPassword: () => Promise.resolve({ error: new Error('Supabase not configured') }),
        signOut: () => Promise.resolve({ error: null }),
      },
    } as any;
  }

  return createBrowserClient(supabaseUrl, supabaseKey);
}