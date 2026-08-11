// app/api/admin/contracts/route.ts
// 근로계약서 생성/목록 조회

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession, requireAdminOrManagerSession } from "@/lib/managerScope";
import { checkAgencyPlanAccess, checkQuota } from "@/lib/planGuard";
import { isValidTemplateKey, DEFAULT_TEMPLATE_KEY, canUseTemplate, canUseTemplateForWage } from "@/lib/contractTemplates";
import { sendAlimtalk } from "@/lib/kakao";
import { findTimeConflict, isSameAgencyConflict } from "@/lib/assignmentOverlap";
import { withContractIssueLock } from "@/lib/assignmentLock";
import { randomUUID } from "crypto";
import { hash } from "bcryptjs";
import { audit } from "@/lib/audit";
// ★13차: 워커 소속 판정을 단일 소스(lib/worker/agencyScope)로 통일. workers/[id]·worker-accounts·verify-*·
//  직접배정과 같은 정의를 공유해 '한 곳만 조이고 형제 라우트 누락'(P0 근본원인)을 구조적으로 차단한다.
import { workerBelongsToAgency, CONSENTED_ASSIGN_STATUSES } from "@/lib/worker/agencyScope";
import { parseWorkingWeekdays, serializeWorkingWeekdays, validateWorkingWeekdays } from "@/lib/payroll/weekdays";

function errToStatus(msg: string) {
  if (msg === "UNAUTHORIZED") return 401;
  if (msg === "FORBIDDEN")    return 403;
  if (msg === "NOT_FOUND")    return 404;
  if (msg.startsWith("VALIDATION:")) return 400;
  return 500;
}

// GET: 계약서 목록
export async function GET(req: NextRequest) {
  try {
    // 매니저=본 기관만, 운영자=전체 기관 횡단 조회(읽기 전용 오버사이트)
    const session = await requireAdminOrManagerSession(req);
    const { searchParams } = new URL(req.url);
    const workerId = searchParams.get("workerId");
    const status = searchParams.get("status");

    const where: any = {};
    if (session.kind === "manager") where.agencyId = session.agencyId;
    if (workerId) {
      try { where.workerId = BigInt(workerId); }
      catch { return NextResponse.json({ success: false, message: "잘못된 userId입니다." }, { status: 400 }); }
    }
    const VALID_STATUSES = ["PENDING", "SIGNED", "COMPLETED", "CANCELLED"];
    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return NextResponse.json({ success: false, message: "유효하지 않은 status입니다." }, { status: 400 });
      }
      where.status = status;
    }

    // ★2026-07-21 감사 P1(성능): 목록에 필요한 컬럼만 select. 종전엔 top-level select 없이 전체 행을 로드해
    //  서명 data-URI(2종)·templateData(자필 이미지 최대 2MB)·특약 등 무거운 필드가 매핑에서 폐기될 뿐인데도
    //  DB→함수로 조회당 수 MB 전송됐다(매니저 상시 화면). 아래 매핑이 쓰는 스칼라만 선택.
    const rows = await prisma.employmentContract.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true, workerId: true, contractStart: true, contractEnd: true,
        siteName: true, workLocation: true, workType: true, commuteGuidanceIncluded: true,
        wageType: true, wageAmount: true, status: true, signToken: true, tokenExpiresAt: true,
        workerSignedAt: true, adminSignedAt: true, pdfUrl: true, createdAt: true,
        user: { select: { workerName: true, loginId: true, phoneNumber: true } },
        agency: { select: { name: true } },
      },
    });

    return NextResponse.json({
      success: true,
      items: rows.map(r => ({
        id: String(r.id),
        workerId: String(r.workerId),
        workerName: r.user.workerName,
        loginId: r.user.loginId,
        userPhone: r.user.phoneNumber,
        agencyName: (r as any).agency?.name ?? "-",
        contractStart: r.contractStart.toISOString(),
        contractEnd: r.contractEnd.toISOString(),
        siteName: r.siteName,
        workLocation: r.workLocation,
        workType: r.workType,
        commuteGuidanceIncluded: r.commuteGuidanceIncluded,
        // 급여 기준 프리필용 — 임금 형태/금액(HOURLY|DAILY|MONTHLY)
        wageType: r.wageType,
        wageAmount: r.wageAmount,
        status: r.status,
        signToken: r.signToken,
        tokenExpiresAt: r.tokenExpiresAt.toISOString(),
        workerSignedAt: r.workerSignedAt?.toISOString() ?? null,
        adminSignedAt: r.adminSignedAt?.toISOString() ?? null,
        pdfUrl: r.pdfUrl,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message ?? "UNKNOWN";
    const status = errToStatus(msg);
    if (status === 500) console.error("[contracts GET]", e);
    return NextResponse.json({ success: false, message: status === 500 ? "서버 오류" : msg }, { status });
  }
}

// POST: 계약서 생성 및 카카오 알림톡 링크 발송
export async function POST(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const body = await req.json();

    const {
      workerId,       // 검색 팝업에서 선택한 기존 유저 ID (선택)
      assignmentId,   // 연결할 배정(SiteAssignment) ID (선택) — 계약완료 시 근무정보 write-back 대상
      manualName,   // 수동 입력: 이름
      manualPhone,  // 수동 입력: 전화번호
      contractStart, contractEnd,
      siteName, workType, commuteGuidanceIncluded,
      customWorkStart, customWorkEnd, adminMemo,
      // ── 표준양식 항목 ──
      workLocation, jobDescription,
      workStartTime, workEndTime, breakStartTime, breakEndTime,
      workDaysPerWeek, weeklyHoliday, workingWeekdays,
      wageType, wageAmount, bonusExists, bonusAmount,
      extraPayExists, extraPayDesc, overtimeRate, wagePayday, wagePayMethod,
      employerBizName, employerPhone, employerAddress, employerRepName,
      applyRepSignature,  // 대표 서명 '적용' 명시 액션(true일 때만 대표 서명 주입)
      workerAddress,
      clauseIds,  // 선택한 특약 조항 id 배열 → 스냅샷
      templateKey, templateData,  // 계약서 양식 + 양식별 추가 입력값
    } = body;

    if (!contractStart || !contractEnd) {
      throw new Error("VALIDATION:계약 시작일과 종료일은 필수입니다.");
    }
    // 임금액 필수 — 급여 기준 자동 생성/계산의 기준값. (근로계약서 법정 필수기재 사항)
    if (wageAmount == null || wageAmount === "" || !(Number(wageAmount) > 0)) {
      throw new Error("VALIDATION:임금액(시급/일급/월급)은 필수입니다.");
    }

    const startDate = new Date(contractStart);
    const endDate   = new Date(contractEnd);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error("VALIDATION:날짜 형식이 올바르지 않습니다.");
    }
    if (endDate <= startDate) {
      throw new Error("VALIDATION:계약 종료일은 시작일보다 이후여야 합니다.");
    }

    // ─── 구독 플랜 + 한도 체크 (★Worker 생성/계약 생성 전에 — 초과 시 임시 Worker orphan 방지) ──
    {
      const planCheck = await checkAgencyPlanAccess(scope.agencyId, "CONTRACT_ONLINE");
      if (!planCheck.allowed) {
        return NextResponse.json({ success: false, message: planCheck.message, reason: planCheck.reason }, { status: 403 });
      }
      const quotaCheck = await checkQuota(scope.agencyId, "workers");
      if (!quotaCheck.allowed) {
        return NextResponse.json({ success: false, message: `직무지도원 한도(${quotaCheck.max}명)에 도달했습니다. 플랜을 업그레이드해주세요.`, reason: "QUOTA_EXCEEDED" }, { status: 403 });
      }
    }

    // ─── 직무지도원 유저 확정 ─────────────────────────────────────
    let userIdBig: bigint;

    if (workerId) {
      // 이력 검색에서 선택한 기존 유저
      try { userIdBig = BigInt(workerId); }
      catch { throw new Error("VALIDATION:잘못된 userId입니다."); }
      // ★크로스테넌트 IDOR 차단: workerId(이력검색 선택) 경로는 본 기관과 기존 관계(계약 이력 또는 배정)가 있는
      //  워커만 허용한다. worker-search가 employmentContracts:{some:{agencyId}}로 스코프하는 UI 불변식과 일치.
      //  (임의 workerId 열거로 타 기관 워커 PII 조회 + 무단 알림톡 발송을 차단. 신규 워커 최초 계약은 아래
      //   수동입력 경로로 생성하고, assignmentId 경로는 하단에서 별도로 소속을 검증한다.)
      if (!(await workerBelongsToAgency(userIdBig, scope.agencyId))) throw new Error("FORBIDDEN");
    } else {
      // 수동 입력: 이름 + 전화번호 필수
      const name  = (manualName  ?? "").trim();
      const phone = (manualPhone ?? "").trim();
      if (!name || !phone) {
        throw new Error("VALIDATION:직무지도원 이름과 전화번호는 필수입니다.");
      }
      if (!/^01[0-9]{1}-?[0-9]{3,4}-?[0-9]{4}$/.test(phone)) {
        throw new Error("VALIDATION:올바른 휴대폰 번호 형식이 아닙니다. (예: 01012345678)");
      }

      // 전화번호로 기존 유저 조회
      const existing = await prisma.worker.findFirst({
        where: { phoneNumber: phone },
        select: { id: true },
      });

      if (existing) {
        // 이미 등록된 유저 — ★11차#1 크로스테넌트 동의 게이트: 본 기관과 기존 관계(계약/배정)가 없는 타 기관
        //  워커는 수동입력으로 직접 계약을 발행할 수 없다(무단 부착·알림톡 방지, workerId 경로와 동일 불변식).
        //  대신 배정 요청(REQUESTED)을 보내 직무지도원이 앱에서 수락(동의)하면 본 기관 관계가 생겨 계약 발행이
        //  가능해진다(정규 동의 경로). 신규(미가입) 전화번호는 아래에서 새 계정으로 생성 — 크로스테넌트 아님.
        if (!(await workerBelongsToAgency(existing.id, scope.agencyId))) {
          return NextResponse.json({
            success: false,
            message: "이미 다른 기관에 가입된 직무지도원입니다. 배정 요청을 보내 직무지도원이 수락하면 계약을 발행할 수 있습니다.",
            reason: "CROSS_AGENCY_CONSENT_REQUIRED",
          }, { status: 409 });
        }
        userIdBig = existing.id;
      } else {
        // 신규 직무지도원 생성 — loginId는 항상 전화번호(하이픈 제거)
        const baseLogin = phone.replace(/-/g, "");
        const conflict  = await prisma.worker.findUnique({ where: { loginId: baseLogin } });
        const loginId   = conflict ? `${baseLogin}_${Date.now()}` : baseLogin;

        let newUser;
        try {
          newUser = await prisma.worker.create({
            data: {
              loginId,
              password: await hash(randomUUID(), 12), // 서명 완료 시 readable 임시 비밀번호로 교체됨
              workerName: name,
              phoneNumber: phone,
              role: "WORKER",
              status: "ACTIVE",
              isTemporary: true,      // 최초 로그인 시 온보딩 플로우 강제
              hasKnownPassword: false, // 9차#3: 랜덤 비번(아무도 모름) → 서명 시 임시비번 발급 대상
            },
          });
        } catch (e: any) {
          // loginId 레이스 컨디션(동시 요청) 대응: timestamp 충돌 시 재시도
          if (e?.code === "P2002") {
            newUser = await prisma.worker.create({
              data: {
                loginId: `${baseLogin}_${Date.now()}_${randomUUID().slice(0, 8)}`, // 재충돌 방지(랜덤 접미)
                password: await hash(randomUUID(), 12),
                workerName: name,
                phoneNumber: phone,
                role: "WORKER",
                status: "ACTIVE",
                isTemporary: true,
                hasKnownPassword: false, // 9차#3: 랜덤 비번 → 서명 시 임시비번 발급 대상
              },
            });
          } else {
            throw e;
          }
        }
        userIdBig = newUser.id;
      }
    }

    // ─── agencyId 결정 ──────────────────────────────────────────
    const agencyId: bigint = scope.agencyId;

    // ─── 연결 배정 검증 (선택) ──────────────────────────────────
    // assignmentId가 오면 해당 배정이 같은 위탁기관·직무지도원 소속인지 확인 후 계약에 연결.
    // 계약 완료(서명) 시 이 배정으로 근무정보 write-back + 상태 전이가 일어난다.
    let assignmentIdBig: bigint | null = null;
    if (assignmentId !== undefined && assignmentId !== null && assignmentId !== "") {
      try { assignmentIdBig = BigInt(assignmentId); }
      catch { throw new Error("VALIDATION:잘못된 assignmentId입니다."); }
      const asgn = await prisma.siteAssignment.findFirst({
        where: { id: assignmentIdBig, workerId: userIdBig, agencyId },
        select: { id: true, siteId: true, status: true },
      });
      if (!asgn) throw new Error("VALIDATION:연결할 배정을 찾을 수 없습니다. (직무지도원/기관 불일치)");
      // ★12차: 연결 배정은 워커가 수락(ACCEPTED/ASSIGNED)했거나 진행/종료된 상태여야 계약 발행 가능. 미수락
      //  REQUESTED를 일방 생성해 그 assignmentId로 계약을 강제 발행하던 크로스테넌트 우회 차단(동의 게이트 정합).
      if (!(CONSENTED_ASSIGN_STATUSES as readonly string[]).includes(asgn.status)) {
        throw new Error("VALIDATION:직무지도원이 아직 배정 요청을 수락하지 않았습니다. 수락 후 계약을 발행해주세요.");
      }

      // ★E1-C(사용자 확정 2026-07-06): 겹침검사를 '서명' 시점이 아니라 '계약 발행' 시점에 둔다.
      //  서명 write-back(worker/contracts)이 이 배정의 workType·기간을 계약값으로 덮어써 CONFIRMED로 승격하는데,
      //  그 값이 같은 워커의 다른 진행중 배정(같은 기관)과 같은 날 겹치면 이중배정이 된다. 발행을 여기서 막으면
      //  서명 경로는 항상 안전해진다(서명 시점 차단 → 서명은 됐는데 배정 미활성=무급, 이던 딜레마 제거).
      const isCustom = workType === "CUSTOM";
      // R4-10: 겹침검사는 '다른 현장'만 대상(finalize=assignment-requests와 기준 통일). 같은 현장 배정은
      //  갱신/재계약(같은 현장 연속)일 수 있어 슬롯이 겹쳐도 이중배정이 아니다 → 같은 현장 신규행 발행시 오탐 409 방지.
      // 이중배정 방지는 전역(크로스기관)으로 — 타 기관 배정과도 겹치면 발행 차단(서명계약↔배정 어긋남 방지).
      //  단, 충돌이 타 기관이면 현장명 비노출(일반 문구). 같은 기관만 현장명 표시.
      const others = await prisma.siteAssignment.findMany({
        where: { workerId: userIdBig, status: { in: ["ACCEPTED", "ASSIGNED", "CONFIRMED", "ACTIVE"] }, NOT: { id: assignmentIdBig }, siteId: { not: asgn.siteId } },
        select: { workType: true, customWorkStart: true, customWorkEnd: true, startDate: true, endDate: true, agencyId: true, site: { select: { companyName: true } } },
      });
      const conflict = findTimeConflict(
        { workType, customWorkStart: isCustom ? customWorkStart : null, customWorkEnd: isCustom ? customWorkEnd : null, startDate, endDate },
        others,
      );
      if (conflict) {
        const msg = isSameAgencyConflict((conflict as any).agencyId, agencyId)
          ? `이 계약의 근무형태·기간이 '${(conflict as any).site?.companyName ?? "다른 현장"}' 배정과 같은 날 근무시간이 겹칩니다. 배정을 조정한 뒤 계약을 발행해주세요.`
          : `이 직무지도원은 이미 다른 일정이 있어 이 근무형태·기간으로 계약을 발행할 수 없습니다. 근무형태·기간을 조정해주세요.`;
        return NextResponse.json({ success: false, code: "TIME_CONFLICT", message: msg }, { status: 409 });
      }
    }


    // ─── 사업주(갑) 정보: 미입력 시 위탁기관 정보로 자동 채움(스냅샷 보존) ──
    const agencyRow: any = await prisma.agency.findUnique({
      where: { id: agencyId },
      select: { name: true, phoneNumber: true, address: true, representativeName: true, representativeSignatureUrl: true, allowedContractTemplates: true } as any,
    });

    // ─── 특약 조항 스냅샷: 선택한 조항 id → {title, body} 배열(작성 시점 보존) ──
    let clauseSnapshot: { title: string; body: string }[] = [];
    if (Array.isArray(clauseIds) && clauseIds.length > 0) {
      const ids = clauseIds
        .map((v: any) => { try { return BigInt(v); } catch { return null; } })
        .filter((v: bigint | null): v is bigint => v !== null);
      if (ids.length > 0) {
        const clauses = await prisma.agencyContractClause.findMany({
          where: { id: { in: ids }, agencyId },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { title: true, body: true },
        });
        clauseSnapshot = clauses.map(c => ({ title: c.title, body: c.body }));
      }
    }

    const toInt = (v: any): number | null => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : null;
    };
    const str = (v: any): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

    // ★근무요일(명시) 정규화·검증. 배열([1,3,5]) 또는 CSV 수용. 있으면 저장 + workDaysPerWeek를 집합 크기로 정합
    //  (이중관리 방지 — 집합이 authoritative). 없으면 null(파생 폴백). 주휴일이 근무요일에 포함되면 400.
    const wwInput: number[] = Array.isArray(workingWeekdays)
      ? workingWeekdays.map((n: unknown) => Number(n))
      : (parseWorkingWeekdays(typeof workingWeekdays === "string" ? workingWeekdays : null) ?? []);
    let workingWeekdaysCsv: string | null = null;
    let effWorkDays = toInt(workDaysPerWeek);
    if (wwInput.length > 0) {
      const v = validateWorkingWeekdays(wwInput, { weeklyHolidayLabel: str(weeklyHoliday) });
      if (!v.ok) throw new Error(`VALIDATION:${v.error}`);
      workingWeekdaysCsv = serializeWorkingWeekdays(wwInput);
      effWorkDays = new Set(wwInput).size; // 소정근로일수 = 근무요일 수(집합 authoritative)
    }

    // ─── 계약서 생성 ────────────────────────────────────────────
    const signToken = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7일
    // 전용 양식은 본 기관에 부여된 경우에만 사용. 미부여 양식은 표준으로 강등.
    const reqTemplateKey = isValidTemplateKey(templateKey) ? templateKey : DEFAULT_TEMPLATE_KEY;
    const grantedTemplateKey = canUseTemplate(reqTemplateKey, agencyRow?.allowedContractTemplates ?? []) ? reqTemplateKey : DEFAULT_TEMPLATE_KEY;
    // 양식이 본문상 특정 임금유형 전제(예: 시급제 양식)인데 다른 유형으로 작성하면 표준으로 강등(라벨 불일치 방지).
    const resolvedTemplateKey = canUseTemplateForWage(grantedTemplateKey, str(wageType)) ? grantedTemplateKey : DEFAULT_TEMPLATE_KEY;
    const resolvedTemplateData = templateData && typeof templateData === "object" ? templateData : undefined;

    // 생성 입력은 락 밖에서 조립하고(순수 계산), 임계구역에서는 재조회+create만 수행한다.
    const contractInput = {
      data: {
        agencyId,
        workerId: userIdBig,
        assignmentId: assignmentIdBig,
        contractStart: startDate,
        contractEnd: endDate,
        siteName: siteName || null,
        workType: workType || null,
        commuteGuidanceIncluded: workType === "FULL_DAY" ? false : (commuteGuidanceIncluded !== false),
        customWorkStart: workType === "CUSTOM" ? customWorkStart : null,
        customWorkEnd:   workType === "CUSTOM" ? customWorkEnd   : null,
        adminMemo: adminMemo || null,
        // 표준양식 항목
        workLocation:   str(workLocation),
        jobDescription: str(jobDescription),
        workStartTime:  str(workStartTime),
        workEndTime:    str(workEndTime),
        breakStartTime: str(breakStartTime),
        breakEndTime:   str(breakEndTime),
        workDaysPerWeek: effWorkDays,
        weeklyHoliday:  str(weeklyHoliday),
        workingWeekdays: workingWeekdaysCsv,
        wageType:       str(wageType),
        wageAmount:     toInt(wageAmount),
        bonusExists:    bonusExists === true,
        bonusAmount:    toInt(bonusAmount),
        extraPayExists: extraPayExists === true,
        extraPayDesc:   str(extraPayDesc),
        overtimeRate:   toInt(overtimeRate),
        wagePayday:     str(wagePayday),
        wagePayMethod:  str(wagePayMethod),
        // 사업주(갑) 스냅샷 — 본 기관 등록값으로 고정. 클라이언트 override 무시(타 기관명 오기입 방지·작성 폼 수정 잠금과 일치).
        employerBizName: agencyRow?.name ?? null,
        employerPhone:   agencyRow?.phoneNumber ?? null,
        employerAddress: agencyRow?.address ?? null,
        employerRepName: agencyRow?.representativeName ?? null,
        workerAddress:   str(workerAddress),
        // 사업주(갑) 서명: 작성 화면에서 '대표 서명 적용'을 명시적으로 선택한 경우에만 주입.
        //  (자동 주입 금지 — 미선택 시 대표 서명칸은 비어 발송된다.)
        adminSignatureUrl: applyRepSignature ? (agencyRow?.representativeSignatureUrl ?? null) : null,
        adminSignedAt:     applyRepSignature && agencyRow?.representativeSignatureUrl ? new Date() : null,
        specialClauses:  clauseSnapshot.length > 0 ? clauseSnapshot : undefined,
        signToken,
        tokenExpiresAt: expiresAt,
        status: "PENDING",
        createdByManagerId: scope.managerId,
        templateKey: resolvedTemplateKey,
        templateData: resolvedTemplateData,
      } as any,
    };

    // ★발행 더블클릭 방어: 같은 배정·기간의 PENDING 계약이 방금(최근 10초) 만들어졌으면 중복 발행으로 보고 409.
    //  발행마다 실비용 카카오 알림톡이 나가고 중복 법적 문서 요청이 생기던 것 차단. 정상 재발행(10초 이후)은 허용.
    // ★E-2: 종전에는 이 재조회와 create 사이에 직렬화가 없어, 순차 더블클릭만 막히고 ms 단위 동시 요청은
    //  둘 다 통과해 중복 계약 2건 + 알림톡 2건이 나갈 수 있었다(best-effort). 배정 단위 advisory 락
    //  임계구역 안으로 재조회를 옮겨 실제 동시성까지 직렬화한다. 감사로그·알림톡은 락 밖(아래)에서 수행.
    class DuplicateIssue extends Error {}
    let contract;
    try {
      contract = await withContractIssueLock({ assignmentId: assignmentIdBig, workerId: userIdBig }, async (tx) => {
        const recentDup = await tx.employmentContract.findFirst({
          where: {
            workerId: userIdBig, assignmentId: assignmentIdBig, status: "PENDING",
            contractStart: startDate, contractEnd: endDate,
            createdAt: { gte: new Date(Date.now() - 10_000) },
          },
          select: { id: true },
        });
        if (recentDup) throw new DuplicateIssue();
        return tx.employmentContract.create(contractInput);
      });
    } catch (e) {
      if (e instanceof DuplicateIssue) {
        return NextResponse.json({ success: false, message: "방금 발행한 계약이 있습니다. 잠시 후 목록에서 확인해주세요." }, { status: 409 });
      }
      throw e;
    }

    await audit(scope, { entityType: "EmploymentContract", entityId: contract.id, action: "create", after: { workerId: String(userIdBig), siteName: siteName || null, wageType: str(wageType), wageAmount: toInt(wageAmount), status: "PENDING" } });

    // ─── 카카오 알림톡 발송 ─────────────────────────────────────
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://able-link.co.kr";
    const contractUrl = `${baseUrl}/contract/${signToken}`;
    let kakaoSent = false;
    let kakaoError: string | undefined;

    try {
      await sendKakaoAlimtalk({ workerId: userIdBig, contractUrl, contractId: String(contract.id) });
      kakaoSent = true;
      await prisma.employmentContract.update({
        where: { id: contract.id },
        data: { tokenSentAt: new Date() },
      });
    } catch (err: any) {
      console.error("[contracts] 카카오 알림톡 발송 실패:", err?.message ?? err);
      kakaoError = "알림톡 발송에 실패했습니다. 링크를 직접 공유해주세요.";
    }

    return NextResponse.json({
      success: true,
      contractId: String(contract.id),
      signToken,
      contractUrl,
      kakaoSent,
      message: kakaoSent ? "알림톡이 발송되었습니다." : (kakaoError ?? "계약서가 생성되었습니다."),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message ?? "UNKNOWN";
    const status = errToStatus(msg);
    if (status === 500) console.error("[contracts POST]", e);
    return NextResponse.json({ success: false, message: status === 500 ? "서버 오류" : msg }, { status });
  }
}

// ── 카카오 알림톡: 계약서 서명 요청 ────────────────────────────
async function sendKakaoAlimtalk(params: { workerId: bigint; contractUrl: string; contractId: string }) {
  const templateCode = process.env.KAKAO_CONTRACT_TEMPLATE_CODE;
  if (!templateCode) throw new Error("KAKAO_CONTRACT_TEMPLATE_CODE 미설정");

  const user = await prisma.worker.findUnique({
    where: { id: params.workerId },
    select: { phoneNumber: true, workerName: true },
  });
  if (!user) throw new Error("사용자를 찾을 수 없습니다.");

  await sendAlimtalk({
    phone: user.phoneNumber, name: user.workerName,
    templateCode,
    subject: "근로계약서 서명 요청",
    message: `안녕하세요 ${user.workerName}님,\n\nAble-Link 근로계약서 서명을 요청드립니다.\n아래 링크에서 확인 후 서명해 주세요.\n${params.contractUrl}\n\n링크는 7일간 유효합니다.\n\n급여 이체를 위해 앱 [내 정보]에서 계좌 정보도 등록해 주세요.`,
    buttons: [{ name: "계약서 서명하기", linkType: "WL", linkMo: params.contractUrl, linkPc: params.contractUrl }],
  });
}
