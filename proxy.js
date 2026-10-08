import { NextResponse } from "next/server";
import { COOKIE, isValidSession } from "@/lib/auth";

// Fast gate in front of everything. Every API route also re-checks the
// session itself (requireAuth), so this is not the only line of defense.
export function proxy(req) {
  const { pathname } = req.nextUrl;
  const authed = isValidSession(req.cookies.get(COOKIE)?.value);

  if (pathname === "/login") {
    return authed ? NextResponse.redirect(new URL("/", req.url)) : NextResponse.next();
  }
  if (pathname.startsWith("/api/auth/")) return NextResponse.next();
  if (authed) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
