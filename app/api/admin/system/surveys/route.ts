// app/api/admin/system/surveys/route.ts
// 운영자(시스템): 모든 만족도 조사 결과 조회 + 위탁기관 전달 토글

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";
import { sendAlimtalk, isAlimtalkReady } from "@/lib/kakao";
import { randomUUID } from "crypto";

const SURVEY_TEMPLATE = "KAKAO_SURVEY_TEMPLATE_CODE";

export async function GET(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const rows = await prisma.satisfactionSurvey.findMany({
      orderBy: { createdAt: "desc" },
      take: 300,
      include: {
        worker: { select: { workerName: true } },
        agency: { select: { name: true } },
      },
    });
    return NextResponse.json({
      success: true,
      items: rows.map(r => ({
        id: String(r.id),
        agencyName: r.agency?.name ?? "",
        workerName: r.worker?.workerName ?? "",
        recipientName: r.recipientName,
        recipientPhone: r.recipientPhone,
        siteName: r.siteName,
        status: r.status,
        auto: r.auto,
        scores: r.scores ?? null,
        overallScore: r.overallScore,
        comment: r.comment,
        sharedWithAgency: r.sharedWithAgency,
        sentAt: r.sentAt?.toISOString() ?? null,
        respondedAt: r.respondedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[system/surveys GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

// POST: 운영자 주도 평가 요청 발송.
//  - 대상 기반: { contractId, recipientName?, recipientPhone? } — 종료 계약 미요청 건.
//  - free-form: { workerId, agencyId, recipientName?, recipientPhone?, siteName? } — 계약 무관 임의 발송.
// 연락처 미입력 시 현장(사업체담당자) 자동 사용.
export async function POST(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const body = await req.json().catch(() => ({}));

    // 발송 컨텍스트 해석(두 경로 공통)
    let agencyId: bigint, workerId: bigint, workerName: string;
    let contractId: bigint | null = null;
    let siteName: string | null = null;

    if (body?.contractId != null && String(body.contractId) !== "") {
      // ── 대상(계약) 기반 ──
      let cid: bigint;
      try { cid = BigInt(body.contractId); } catch { return NextResponse.json({ success: false, message: "대상 계약을 선택하세요." }, { status: 400 }); }
      const contract = await prisma.employmentContract.findUnique({
        where: { id: cid },
        select: { id: true, agencyId: true, workerId: true, siteName: true, workerFilledSiteName: true, user: { select: { workerName: true } } },
      });
      if (!contract) return NextResponse.json({ success: false, message: "계약을 찾을 수 없습니다." }, { status: 404 });

      // 중복 방지: 이 계약으로 진행중(PENDING)/완료(RESPONDED)면 차단(만료·취소는 재발송 허용)
      const dup = await prisma.satisfactionSurvey.findFirst({
        where: { contractId: contract.id, status: { in: ["PENDING", "RESPONDED"] } },
        select: { status: true },
      });
      if (dup) return NextResponse.json({ success: false, message: dup.status === "RESPONDED" ? "이미 응답이 완료된 요청입니다." : "이미 발송된 요청이 있습니다." }, { status: 409 });

      contractId = contract.id;
      agencyId = contract.agencyId;
      workerId = contract.workerId;
      workerName = contract.user?.workerName ?? "직무지도원";
      siteName = contract.siteName || contract.workerFilledSiteName || null;
    } else {
      // ── free-form(계약 무관) ──
      let wid: bigint, aid: bigint;
      try { wid = BigInt(body?.workerId); aid = BigInt(body?.agencyId); }
      catch { return NextResponse.json({ success: false, message: "직무지도원과 위탁기관를 선택하세요." }, { status: 400 }); }

      const [worker, agency, linked] = await Promise.all([
        prisma.worker.findUnique({ where: { id: wid }, select: { workerName: true } }),
        prisma.agency.findUnique({ where: { id: aid }, select: { id: true } }),
        prisma.employmentContract.findFirst({ where: { agencyId: aid, workerId: wid }, select: { id: true } }),
      ]);
      if (!worker) return NextResponse.json({ success: false, message: "직무지도원을 찾을 수 없습니다." }, { status: 404 });
      if (!agency) return NextResponse.json({ success: false, message: "위탁기관를 찾을 수 없습니다." }, { status: 404 });
      if (!linked) return NextResponse.json({ success: false, message: "해당 위탁기관와 계약 이력이 있는 직무지도원만 요청할 수 있습니다." }, { status: 400 });

      // 최근 14일 내 진행중 요청 있으면 중복 차단(오발송 방지)
      const recent = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const dup = await prisma.satisfactionSurvey.findFirst({
        where: { agencyId: aid, workerId: wid, status: "PENDING", createdAt: { gte: recent } },
        select: { id: true },
      });
      if (dup) return NextResponse.json({ success: false, message: "최근 14일 내 발송된 진행 중 요청이 있습니다." }, { status: 409 });

      agencyId = aid;
      workerId = wid;
      workerName = worker.workerName;
      siteName = (String(body?.siteName ?? "").trim() || null);
    }

    // 사업체 담당자 연락처: body 우선, 없으면 현장(사업체담당자)
    const site = siteName
      ? await prisma.site.findFirst({
          where: { agencyId, companyName: siteName },
          select: { businessContactName: true, businessContactPhone: true },
        })
      : null;
    const recipientName = (String(body?.recipientName ?? "").trim() || site?.businessContactName || "").trim();
    const phone = (String(body?.recipientPhone ?? "").trim() || site?.businessContactPhone || "").trim();
    if (!/^01[0-9]-?[0-9]{3,4}-?[0-9]{4}$/.test(phone)) {
      return NextResponse.json({ success: false, message: "사업체 담당자 휴대폰 번호가 없거나 올바르지 않습니다. 현장 정보를 확인하거나 직접 입력하세요." }, { status: 400 });
    }

    const token = randomUUID();
    const survey = await prisma.satisfactionSurvey.create({
      data: {
        agencyId, workerId, contractId,
        recipientName: recipientName || null,
        recipientPhone: phone,
        siteName,
        token,
        status: "PENDING",
        auto: false, // 운영자 수동(매니저 아님): createdByManagerId=null 로 OPERATOR 구분
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    });

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://able-link.co.kr";
    const surveyUrl = `${baseUrl}/survey/${token}`;

    let sent = false;
    if (isAlimtalkReady(SURVEY_TEMPLATE)) {
      try {
        await sendAlimtalk({
          phone, name: recipientName || "담당자",
          templateCode: process.env[SURVEY_TEMPLATE]!,
          subject: "직무지도원 만족도 조사",
          message: `${workerName} 직무지도원에 대한 만족도 조사를 요청드립니다.\n\n아래 링크에서 평가해 주세요.\n\n${surveyUrl}\n\n링크는 14일간 유효합니다.`,
          buttons: [{ name: "만족도 평가하기", linkType: "WL", linkMo: surveyUrl, linkPc: surveyUrl }],
        });
        sent = true;
        await prisma.satisfactionSurvey.update({ where: { id: survey.id }, data: { sentAt: new Date() } });
      } catch (err: any) {
        console.error("[system/surveys POST] 알림톡 발송 실패:", err?.message ?? err);
      }
    }

    return NextResponse.json({
      success: true, surveyUrl, sent,
      message: sent ? "평가 요청 알림톡이 발송되었습니다." : "요청이 생성되었습니다. 알림톡 미설정 시 링크를 직접 공유하세요.",
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[system/surveys POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

// PATCH: 결과를 위탁기관에 전달(공유) 토글
export async function PATCH(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const body = await req.json();
    let id: bigint;
    try { id = BigInt(body.id); } catch { return NextResponse.json({ success: false, message: "잘못된 ID" }, { status: 400 }); }
    await prisma.satisfactionSurvey.update({
      where: { id },
      data: { sharedWithAgency: body.sharedWithAgency === true },
    });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[system/surveys PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
