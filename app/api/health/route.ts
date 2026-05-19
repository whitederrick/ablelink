// admlink-admin/app/api/health/route.ts
// Set the runtime to Node.js

export const runtime = "nodejs";

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { ok: true, ts: Date.now() },
    { status: 200 }
  );
}