// app/api/csp-report/route.ts
// CSP 위반 보고 수집(Report-Only 단계) — 브라우저가 자동 POST. 로그만 남기고 항상 204.
// enforce 전환 판단용: Vercel 로그에서 "[csp-report]"를 모아 허용 목록에 빠진 도메인을 찾는다.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { getRateLimitIp } from "@/lib/clientIp";

export async function POST(req: NextRequest) {
  // 공개 엔드포인트 — 로그 폭주 방어(브라우저 정상 보고는 저빈도).
  const rl = await checkRateLimit(`csp-report:${getRateLimitIp(req)}`, { max: 60, windowSec: 10 * 60, blockSec: 10 * 60 });
  if (!rl.allowed) return new NextResponse(null, { status: 204 }); // 보고는 유실돼도 무해 — 조용히 무시

  try {
    const body = await req.json().catch(() => null);
    // 형식 2종: 구형 { "csp-report": {...} } / Reporting API [ { body: {...} } ]
    const r = (body && (body["csp-report"] ?? (Array.isArray(body) ? body[0]?.body : body))) ?? {};
    const line = {
      doc: r["document-uri"] ?? r.documentURL ?? "",
      directive: r["violated-directive"] ?? r["effective-directive"] ?? r.effectiveDirective ?? "",
      blocked: r["blocked-uri"] ?? r.blockedURL ?? "",
      source: r["source-file"] ?? r.sourceFile ?? "",
    };
    if (line.directive || line.blocked) console.warn("[csp-report]", JSON.stringify(line));
  } catch { /* 파싱 실패 무시 */ }
  return new NextResponse(null, { status: 204 });
}
