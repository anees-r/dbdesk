import { NextResponse } from "next/server";
import {
  authConfigError, verifyPassword, createSessionToken, sessionCookie, sessionMaxAge,
  clientIp, loginBlockedFor, recordFailedLogin, clearFailedLogins,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const configError = authConfigError();
  if (configError) return NextResponse.json({ error: configError }, { status: 500 });

  const ip = clientIp(req);
  const wait = loginBlockedFor(ip);
  if (wait) {
    return NextResponse.json(
      { error: `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} min.` },
      { status: 429, headers: { "retry-after": String(wait) } }
    );
  }

  const { password } = await req.json().catch(() => ({}));
  if (!verifyPassword(password)) {
    recordFailedLogin(ip);
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  clearFailedLogins(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie(req, createSessionToken(), sessionMaxAge()));
  return res;
}
