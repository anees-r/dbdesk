import { NextResponse } from "next/server";
import { sessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie(req, "", 0));
  return res;
}
