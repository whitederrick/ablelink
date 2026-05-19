// app/api/worker/auth/logout/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { WORKER_COOKIE } from "@/app/worker/_lib/session";

export async function POST() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(WORKER_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return res;
}
