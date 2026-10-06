import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";
import { permissionForRoute } from "./lib/permissions";

const intlProxy = createMiddleware(routing);

/**
 * TODO(supabase-auth): this reads a plain `session` cookie the login page
 * sets today (see lib/session.ts). Replace with real verification of a
 * Supabase-issued/refreshed JWT (e.g. via @supabase/ssr's createServerClient)
 * once Supabase Auth is wired up. This is defense-in-depth alongside the
 * NestJS guards and Postgres RLS — never the only check.
 */
export function proxy(request: NextRequest) {
  const response = intlProxy(request);

  const { pathname } = request.nextUrl;
  const withoutLocale = pathname.replace(/^\/(en|ar)/, "") || "/";

  const PUBLIC_ROUTES = ["/login", "/forgot-password", "/reset-password"];
  const sessionCookie = request.cookies.get("session")?.value;
  const isProtected = !PUBLIC_ROUTES.some((p) => withoutLocale.startsWith(p));

  if (isProtected && withoutLocale !== "/" && !sessionCookie) {
    const locale = pathname.match(/^\/(en|ar)/)?.[1] ?? routing.defaultLocale;
    return NextResponse.redirect(new URL(`/${locale}/login`, request.url));
  }

  // Redirect away from any route whose required permission (see
  // lib/permissions.ts's ROUTE_PERMISSIONS — the same map RequirePermission
  // and the sidebar use) the session's permissions array doesn't include.
  // Still just a UX layer: the real enforcement is the backend's
  // RolesGuard, and RequirePermission covers the same ground at the page
  // level for the cases this middleware's cookie parsing might miss.
  // Falls back to /profile (always accessible — ROUTE_PERMISSIONS maps it
  // to `null`) rather than /dashboard, since /dashboard itself needs
  // view_reports and redirecting there for a user without it would loop.
  if (isProtected && sessionCookie && withoutLocale !== "/profile") {
    const requiredPermission = permissionForRoute(withoutLocale);
    if (requiredPermission && requiredPermission.length > 0) {
      try {
        const session = JSON.parse(sessionCookie);
        const permissions: string[] = Array.isArray(session.permissions) ? session.permissions : [];
        if (!requiredPermission.some((p) => permissions.includes(p))) {
          const locale = pathname.match(/^\/(en|ar)/)?.[1] ?? routing.defaultLocale;
          return NextResponse.redirect(new URL(`/${locale}/profile`, request.url));
        }
      } catch {
        // malformed cookie, fall through to intl response
      }
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
