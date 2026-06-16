// app/api/admin/assignments/route.ts
// SiteAssignment 생성/조회(간단 list) API

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrManagerSession } from "@/lib/managerScope";

function errToStatus(msg: string) {
  if (msg === "UNAUTHORIZED") return 401;
  if (msg === "FORBIDDEN") return 403;
  if (msg === "NOT_FOUND") return 404;
  if (msg.startsWith("VALIDATION:")) return 400;
  return 500;
}

function isValidNumericId(s: string) {
  return /^[0-9]+$/.test(s);
}

function toItem(r: any) {
  return {
    id: String(r.id),
    workerId: String(r.workerId),
    siteId: String(r.siteId),
    status: r.status,
    startDate: r.startDate?.toISOString?.() ?? r.startDate ?? null,
    endDate: r.endDate?.toISOString?.() ?? r.endDate ?? null,
    assignedAt: r.assignedAt?.toISOString?.() ?? r.assignedAt ?? null,
    confirmedAt: r.confirmedAt?.toISOString?.() ?? r.confirmedAt ?? null,
    rejectedAt: r.rejectedAt?.toISOString?.() ?? r.rejectedAt ?? null,
    droppedAt: r.droppedAt?.toISOString?.() ?? r.droppedAt ?? null,
    endedAt: r.endedAt?.toISOString?.() ?? r.endedAt ?? null,
    statusReason: r.statusReason ?? null,
    assignedByManagerId: r.assignedByManagerId != null ? String(r.assignedByManagerId) : null,
    workType: r.workType ?? "FULL_DAY",
    serviceStep: r.serviceStep ?? "FIELD_TRAINING",
    adaptationStartDate: r.adaptationStartDate?.toISOString?.() ?? r.adaptationStartDate ?? null,
    commuteGuidanceIncluded: r.commuteGuidanceIncluded ?? true,
    attendanceButtonExempt: r.attendanceButtonExempt ?? false,
    customWorkStart: r.customWorkStart ?? null,
    customWorkEnd: r.customWorkEnd ?? null,
    site: r.site
      ? {
          id: String(r.site.id),
          companyName: r.site.companyName,
          address: r.site.address,
          agencyId: r.site.agencyId != null ? String(r.site.agencyId) : null,
        }
      : null,
    user: r.user
      ? {
          id: String(r.user.id),
          workerName: r.user.workerName,
          loginId: r.user.loginId,
          phoneNumber: r.user.phoneNumber,
          role: r.user.role,
          status: r.user.status,
        }
      : null,
  };
}

// GET: 간단 조회(필요 최소)
// - 필터: siteId, workerId, status
export async function GET(req: NextRequest) {
  try {
    const session = await requireAdminOrManagerSession(req);

    const { searchParams } = new URL(req.url);
    const siteIdStr = (searchParams.get("siteId") || "").trim();
    const userIdStr = (searchParams.get("workerId") || "").trim();
    const status = (searchParams.get("status") || "").trim();

    const where: any = {};
    if (siteIdStr) {
      if (!isValidNumericId(siteIdStr)) throw new Error("VALIDATION:siteId");
      where.siteId = BigInt(siteIdStr);
    }
    if (userIdStr) {
      if (!isValidNumericId(userIdStr)) throw new Error("VALIDATION:workerId");
      where.workerId = BigInt(userIdStr);
    }
    if (status) where.status = status;

    // manager: 본인 agency의 site 배정만 / admin(운영자): 전체
    if (session.kind === "manager") where.site = { agencyId: session.agencyId };

    const rows = await prisma.siteAssignment.findMany({
      where,
      orderBy: { id: "desc" },
      take: 50,
      select: {
        id: true,
        workerId: true,
        siteId: true,
        status: true,
        startDate: true,
        endDate: true,
        assignedAt: true,
        confirmedAt: true,
        rejectedAt: true,
        droppedAt: true,
        endedAt: true,
        statusReason: true,
        assignedByManagerId: true,
        site: { select: { id: true, companyName: true, address: true, agencyId: true } },
        user: {
          select: { id: true, workerName: true, loginId: true, phoneNumber: true, role: true, status: true },
        },
        workType: true,
        serviceStep: true,
        adaptationStartDate: true,
        commuteGuidanceIncluded: true,
        attendanceButtonExempt: true,
        customWorkStart: true,
        customWorkEnd: true,
      },
    });

    // 계약서 연결 여부: assignmentId로 직접 연결됐거나(우선), 없으면 해당 직무지도원의
    // 서명완료(SIGNED/COMPLETED) 계약서 존재로 판정 → 모달에서 계약파생 필드 변경 경고 게이트.
    const asgnIds = rows.map(r => r.id);
    const workerIds = Array.from(new Set(rows.map(r => r.workerId)));
    const contracts = asgnIds.length
      ? await prisma.employmentContract.findMany({
          where: {
            status: { in: ["SIGNED", "COMPLETED"] },
            OR: [{ assignmentId: { in: asgnIds } }, { workerId: { in: workerIds } }],
          },
          select: { assignmentId: true, workerId: true },
        })
      : [];
    const contractAsgnIds = new Set(contracts.filter(c => c.assignmentId != null).map(c => String(c.assignmentId)));
    const contractWorkerIds = new Set(contracts.map(c => String(c.workerId)));
    const items = rows.map(r => ({
      ...toItem(r),
      hasContract: contractAsgnIds.has(String(r.id)) || contractWorkerIds.has(String(r.workerId)),
    }));

    return NextResponse.json({ success: true, items });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}

// POST: 배정 생성 (ASSIGNED)
// body: { siteId, workerId, isMainWorker?, memo? }
export async function POST(req: NextRequest) {
  try {
    const session = await requireAdminOrManagerSession(req);

    const body = await req.json();
    const siteIdStr = String(body.siteId ?? "").trim();
    const userIdStr = String(body.workerId ?? "").trim();

    if (!isValidNumericId(siteIdStr)) throw new Error("VALIDATION:siteId");
    if (!isValidNumericId(userIdStr)) throw new Error("VALIDATION:workerId");

    const siteId = BigInt(siteIdStr);
    const workerId = BigInt(userIdStr);

    // 배정 대상 site 검증. manager는 본인 agency 소속만, admin(운영자)은 임의 활성 사이트.
    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: { agencyId: true, isActive: true },
    });
    if (!site) throw new Error("NOT_FOUND");
    if (!site.isActive) throw new Error("VALIDATION:siteInactive");
    if (site.agencyId == null) throw new Error("FORBIDDEN"); // 배정은 위탁기관 귀속 사이트만(급여·구독 집계)
    if (session.kind === "manager" && site.agencyId !== session.agencyId) throw new Error("FORBIDDEN");
    const effectiveAgencyId = site.agencyId;

    // 배정 대상 user 존재 확인
    const user = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { status: true },
    });
    if (!user) throw new Error("NOT_FOUND");
    if (String(user.status) !== "ACTIVE") throw new Error("VALIDATION:userInactive");

    // 동일 site/user에 진행 중 배정(요청·수락·계약대기·근무)이 이미 있으면 중복 방지(정책)
    const dup = await prisma.siteAssignment.findFirst({
      where: { siteId, workerId, status: { in: ["REQUESTED", "ACCEPTED", "ASSIGNED", "CONFIRMED", "ACTIVE"] } },
      select: { id: true },
    });
    if (dup) return NextResponse.json({ success: false, message: "이미 해당 현장에 배정(또는 요청)된 직무지도원입니다." }, { status: 409 });

    const isMainWorker = body.isMainWorker === false ? false : true;
    const memo = body.memo != null ? String(body.memo).trim() : null;

    // 근무형태
    const rawWorkType = body.workType != null ? String(body.workType).trim() : null;
    const validWorkTypes = ["AM", "PM", "FULL_DAY", "CUSTOM"];
    const workType = validWorkTypes.includes(rawWorkType ?? "") ? rawWorkType : "FULL_DAY";
    // FULL_DAY는 법적 8시간 제한으로 출퇴근 지도 불가
    const commuteGuidanceIncluded = workType === "FULL_DAY" ? false : (body.commuteGuidanceIncluded !== false);
    const customWorkStart = workType === "CUSTOM" ? (body.customWorkStart ?? null) : null;
    const customWorkEnd   = workType === "CUSTOM" ? (body.customWorkEnd ?? null) : null;
    const attendanceButtonExempt = body.attendanceButtonExempt === true; // 시프티 병행: 출퇴근 버튼 면제

    // 서비스 단계: 지원고용(현장훈련) / 사전훈련 / 취업 후 적응지도. 미지정 시 기본 FIELD_TRAINING.
    const validSteps = ["PRE_TRAINING", "FIELD_TRAINING", "ADAPTATION"];
    const rawStep = body.serviceStep != null ? String(body.serviceStep).trim() : null;
    const serviceStep = validSteps.includes(rawStep ?? "") ? (rawStep as any) : "FIELD_TRAINING";

    // 지원고용 훈련 → 적응지도 전환일(선택). serviceStep=FIELD_TRAINING + 전환일 설정 시 단계 분할.
    const adaptationStartDate = body.adaptationStartDate ? new Date(body.adaptationStartDate) : null;

    // manager 로그인 계정(Manager.id) 기록. admin(운영자) 직접 배정은 null.
    const assignedByManagerId = session.kind === "manager" ? session.managerId : null;

    // 배정 요청 모드: mode === "request" → 즉시 ASSIGNED가 아니라 REQUESTED(요청 중) 생성.
    // 요청 근무형태(복수)·회신 기한을 저장하고, 후보 수락 시 workType이 확정된다.
    const isRequest = body.mode === "request";
    let requestedWorkTypesCsv: string | null = null;
    let replyDeadline: Date | null = null;
    if (isRequest) {
      const wts: string[] = Array.isArray(body.requestedWorkTypes)
        ? body.requestedWorkTypes.map((w: any) => String(w).trim()).filter((w: string) => validWorkTypes.includes(w))
        : [];
      if (wts.length === 0) throw new Error("VALIDATION:requestedWorkTypes");
      requestedWorkTypesCsv = Array.from(new Set(wts)).join(",");
      if (!body.replyDeadline) throw new Error("VALIDATION:replyDeadline");
      const d = new Date(body.replyDeadline);
      if (isNaN(d.getTime())) throw new Error("VALIDATION:replyDeadline");
      // 회신 기한은 요청일(오늘, 발송일)보다 앞설 수 없음
      if (String(body.replyDeadline).slice(0, 10) < new Date().toISOString().slice(0, 10)) throw new Error("VALIDATION:replyDeadlinePast");
      replyDeadline = d;
    }

    // 닫힌 기록 처리: 워커가 거절(REJECTED)한 건은 다시 요청 불가. 탈락/기한초과(DROPPED/EXPIRED)는 행을 재사용(중복 방지).
    let reuseId: bigint | null = null;
    const closed = await prisma.siteAssignment.findFirst({
      where: { siteId, workerId, status: { in: ["REJECTED", "DROPPED", "EXPIRED"] } },
      orderBy: { id: "desc" },
      select: { id: true, status: true },
    });
    if (closed?.status === "REJECTED") {
      return NextResponse.json({ success: false, message: "직무지도원이 거절한 요청입니다. 다시 요청할 수 없습니다." }, { status: 409 });
    }
    if (closed) reuseId = closed.id;

    // 파이프라인(assignment-pipeline-design.md): 요청=REQUESTED(회신 대기) → 후보 수락 → 선정 ASSIGNED(계약 대기)
    // → 계약 서명 CONFIRMED → 연결+위치확정 ACTIVE. 과금/급여(ACTIVE만)는 정상근무 시점부터 집계된다.
    const dataObj: any = {
      siteId,
      workerId,
      agencyId: effectiveAgencyId, // 위탁기관 스코프 쿼리(급여·CSV·근태inbox·휴무)에서 누락 방지
      status: isRequest ? "REQUESTED" : "ASSIGNED",
      requestedWorkTypes: requestedWorkTypesCsv,
      replyDeadline,
      serviceStep,
      adaptationStartDate,
      isMainWorker,
      assignedAt: new Date(),
      startDate: body.startDate ? new Date(body.startDate) : new Date(),
      endDate: body.endDate ? new Date(body.endDate) : null,
      assignedByManagerId,
      statusReason: memo,
      // 요청 단계에선 근무형태 미확정(후보 수락 시 선택값으로 세팅)
      workType: isRequest ? null : workType,
      commuteGuidanceIncluded,
      attendanceButtonExempt,
      customWorkStart,
      customWorkEnd,
      rejectedAt: null, droppedAt: null, // 재사용 시 닫힘 흔적 초기화(신규 생성엔 무해)
    };
    const selectObj = {
      id: true,
      workerId: true,
      siteId: true,
      status: true,
      startDate: true,
      endDate: true,
      assignedAt: true,
      confirmedAt: true,
      rejectedAt: true,
      droppedAt: true,
      endedAt: true,
      statusReason: true,
      assignedByManagerId: true,
      site: { select: { id: true, companyName: true, address: true, agencyId: true } },
      user: { select: { id: true, workerName: true, loginId: true, phoneNumber: true, role: true, status: true } },
    } as const;
    const created = reuseId
      ? await prisma.siteAssignment.update({ where: { id: reuseId }, data: dataObj, select: selectObj })
      : await prisma.siteAssignment.create({ data: dataObj, select: selectObj });

    // 배정 요청은 워커에게 앱 내 알림(무료) — 홈에서 수락/거절.
    if (isRequest) {
      const wtLabel: Record<string, string> = { AM: "오전", PM: "오후", FULL_DAY: "전일", CUSTOM: "직접" };
      const wtText = (requestedWorkTypesCsv ?? "").split(",").filter(Boolean).map(w => wtLabel[w] ?? w).join("·");
      try {
        await prisma.workerNotice.create({
          data: {
            workerId,
            agencyId: effectiveAgencyId,
            title: "[배정] 새 배정 요청이 도착했습니다",
            body:
              `${created.site?.companyName ?? "현장"}에서 배정 요청이 도착했습니다.` +
              (wtText ? `\n요청 근무형태: ${wtText}` : "") +
              (replyDeadline ? `\n회신 기한: ${replyDeadline.toISOString().slice(0, 10)} (이후 자동 탈락)` : "") +
              `\n\n홈에서 희망 근무형태를 선택해 수락하거나 거절해주세요.`,
            type: "INFO",
            link: "/worker/home",
          },
        });
      } catch (notifyErr) {
        console.warn("[assignments] 배정 요청 알림 생성 실패:", notifyErr);
      }
    }

    return NextResponse.json({ success: true, item: toItem(created) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}
