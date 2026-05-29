export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { clearManagerSessionCookieOnResponse } from "@/lib/managerCookies";

export async function POST() {
  const res = NextResponse.json({ success: true });
  clearManagerSessionCookieOnResponse(res);
  return res;
}
