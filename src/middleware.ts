import { createServerClient, type SetAllCookies } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabasePublicKey, getSupabaseUrl } from '@/lib/supabase/env';

export async function middleware(request: NextRequest) {
  // API ตรวจสิทธิ์และ refresh cookie ใน route handler เอง จึงไม่เรียก Auth ซ้ำที่ middleware
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    getSupabaseUrl()!,
    getSupabasePublicKey()!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Public routes (bypass auth check)
  const publicRoutes = ['/'];
  if (publicRoutes.includes(request.nextUrl.pathname)) {
    if (request.nextUrl.pathname === '/' && user) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return supabaseResponse;
  }

  // Protected routes — just check auth, skip profile/role check (handled client-side via AuthProvider)
  if (!user) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
