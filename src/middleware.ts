import { createServerClient, type SetAllCookies } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// เส้นทางที่ไม่ผ่านการตรวจ session ของ middleware
// - /api/cron/*  : Vercel Cron ยิงมาโดยไม่มี cookie ผู้ใช้ จึงตรวจสิทธิ์เองด้วย
//                  CRON_SECRET ที่ตัว route (ดู api/cron/overdue-documents)
// - /api/auth/resolve-username : ต้องเรียกก่อนล็อกอิน จึงยังไม่มี session
const AUTH_EXEMPT_PREFIXES = ['/api/cron/', '/api/auth/'];

export async function middleware(request: NextRequest) {
  if (AUTH_EXEMPT_PREFIXES.some((p) => request.nextUrl.pathname.startsWith(p))) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
    if (request.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/', request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
