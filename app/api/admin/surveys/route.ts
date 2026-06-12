// app/api/admin/surveys/route.ts
// 매니저: 직무지도원 만족도 조사 요청(사업체 담당자 대상 알림톡) + 목록. PRO 전용.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { checkAgencyPlanAccess } from "@/lib/planGuard";
import { sendAlimtalk, isAlimtalkReady } from "@/lib/kakao";
import { randomUUID } from "crypto";

const SURVEY_TEMPLATE = "KAKAO_SURVEY_TEMPLATE_CODE";

function errToStatus(msg: string) {
  if (msg === "UNAUTHORIZED") return 401;
  if (msg === "FORBIDDEN") return 403;
  if (msg.startsWith("VALIDATION:")) return 400;
  return 500;
}

// GET: 에이전시 만족도 조사 목록 (결과 점수는 운영자 전용 → 매니저에겐 상태만)
export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const rows = await prisma.satisfactionSurvey.findMany({
      where: { agencyId: scope.agencyId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { worker: { select: { workerName: true, loginId: true } } },
    });
    return NextResponse.json({
      success: true,
      items: rows.map(r => ({
        id: String(r.id),
        workerName: r.worker?.workerName ?? "",
        workerLoginId: r.worker?.loginId ?? "",
        recipientName: r.recipientName,
        recipientPhone: r.recipientPhone,
        siteName: r.siteName,
        status: r.status,
        auto: r.auto,
        // 결과 점수/코멘트는 운영자 전용 — 매니저에겐 노출하지 않음
        sharedWithAgency: r.sharedWithAgency,
        overallScore: r.sharedWithAgency ? r.overallScore : null,
        comment: r.sharedWithAgency ? r.comment : null,
        sentAt: r.sentAt?.toISOString() ?? null,
        respondedAt: r.respondedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message ?? "UNKNOWN";
    const status = errToStatus(msg);
    if (status === 500) console.error("[surveys GET]", e);
    return NextResponse.json({ success: false, message: status === 500 ? "서버 오류" : msg }, { status });
  }
}

// POST: 만족도 조사 생성 + 알림톡 발송 (건별 요청)
export async function POST(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);

    const planCheck = await checkAgencyPlanAccess(scope.agencyId, "SATISFACTION_SURVEY");
    if (!planCheck.allowed) {
      return NextResponse.json({ success: false, message: planCheck.message, reason: planCheck.reason }, { status: 403 });
    }

    const body = await req.json();
    const { workerId, recipientName, recipientPhone, siteName } = body;
    if (!workerId) throw new Error("VALIDATION:평가 대상 직무지도원을 선택하세요.");
    const phone = String(recipientPhone ?? "").trim();
    if (!/^01[0-9]-?[0-9]{3,4}-?[0-9]{4}$/.test(phone)) {
      throw new Error("VALIDATION:사업체 담당자 휴대폰 번호가 올바르지 않습니다.");
    }

    let widBig: bigint;
    try { widBig = BigInt(workerId); } catch { throw new Error("VALIDATION:잘못된 직무지도원 ID"); }

    // 본인 에이전시와 계약 이력이 있는 직무지도원만 조사 요청 가능
    const linked = await prisma.employmentContract.findFirst({
      where: { agencyId: scope.agencyId, workerId: widBig },
      select: { id: true },
    });
    if (!linked) throw new Error("VALIDATION:본인 에이전시와 계약 이력이 있는 직무지도원만 요청할 수 있습니다.");

    const worker = await prisma.worker.findUnique({ where: { id: widBig }, select: { workerName: true } });

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14일

    const survey = await prisma.satisfactionSurvey.create({
      data: {
        agencyId: scope.agencyId,
        workerId: widBig,
        recipientName: recipientName?.trim() || null,
        recipientPhone: phone,
        siteName: siteName?.trim() || null,
        token,
        status: "PENDING",
        expiresAt,
        createdByManagerId: scope.managerId,
      },
    });

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://able-link.co.kr";
    const surveyUrl = `${baseUrl}/survey/${token}`;

    let sent = false;
    if (isAlimtalkReady(SURVEY_TEMPLATE)) {
      try {
        await sendAlimtalk({
          phone, name: recipientName?.trim() || "담당자",
          templateCode: process.env[SURVEY_TEMPLATE]!,
          subject: "직무지도원 만족도 조사",
          message: `${worker?.workerName ?? "직무지도원"} 직무지도원에 대한 만족도 조사를 요청드립니다.\n\n아래 링크에서 평가해 주세요.\n\n${surveyUrl}\n\n링크는 14일간 유효합니다.`,
          buttons: [{ name: "만족도 평가하기", linkType: "WL", linkMo: surveyUrl, linkPc: surveyUrl }],
        });
        sent = true;
        await prisma.satisfactionSurvey.update({ where: { id: survey.id }, data: { sentAt: new Date() } });
      } catch (err: any) {
        console.error("[surveys] 알림톡 발송 실패:", err?.message ?? err);
      }
    }

    return NextResponse.json({
      success: true,
      surveyUrl,
      sent,
      message: sent ? "만족도 조사 알림톡이 발송되었습니다." : "조사가 생성되었습니다. 알림톡 미설정 시 링크를 직접 공유하세요.",
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message ?? "UNKNOWN";
    const status = errToStatus(msg);
    if (status === 500) console.error("[surveys POST]", e);
    return NextResponse.json({ success: false, message: status === 500 ? "서버 오류" : msg }, { status });
  }
}
