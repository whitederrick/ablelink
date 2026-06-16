// app/api/admin/contracts/route.ts
// 근로계약서 생성/목록 조회

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { checkAgencyPlanAccess, checkQuota } from "@/lib/planGuard";
import { isValidTemplateKey, DEFAULT_TEMPLATE_KEY } from "@/lib/contractTemplates";
import { sendAlimtalk } from "@/lib/kakao";
import { randomUUID } from "crypto";
import { hash } from "bcryptjs";

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
    const scope = await requireManagerSession(req);
    const { searchParams } = new URL(req.url);
    const workerId = searchParams.get("workerId");
    const status = searchParams.get("status");

    const where: any = {};
    where.agencyId = scope.agencyId;
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

    const rows = await prisma.employmentContract.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        user: { select: { workerName: true, loginId: true, phoneNumber: true } },
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
      workDaysPerWeek, weeklyHoliday,
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

    // ─── 직무지도원 유저 확정 ─────────────────────────────────────
    let userIdBig: bigint;

    if (workerId) {
      // 이력 검색에서 선택한 기존 유저
      try { userIdBig = BigInt(workerId); }
      catch { throw new Error("VALIDATION:잘못된 userId입니다."); }
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
        // 이미 등록된 유저
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
              isTemporary: true, // 최초 로그인 시 온보딩 플로우 강제
            },
          });
        } catch (e: any) {
          // loginId 레이스 컨디션(동시 요청) 대응: timestamp 충돌 시 재시도
          if (e?.code === "P2002") {
            newUser = await prisma.worker.create({
              data: {
                loginId: `${baseLogin}_${Date.now()}`,
                password: await hash(randomUUID(), 12),
                workerName: name,
                phoneNumber: phone,
                role: "WORKER",
                status: "ACTIVE",
                isTemporary: true,
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
        select: { id: true },
      });
      if (!asgn) throw new Error("VALIDATION:연결할 배정을 찾을 수 없습니다. (직무지도원/기관 불일치)");
    }

    // ─── 구독 플랜 + 한도 체크 ──────────────────────────────────
    const planCheck = await checkAgencyPlanAccess(agencyId, "CONTRACT_ONLINE");
    if (!planCheck.allowed) {
      return NextResponse.json({ success: false, message: planCheck.message, reason: planCheck.reason }, { status: 403 });
    }
    const quotaCheck = await checkQuota(agencyId, "workers");
    if (!quotaCheck.allowed) {
      return NextResponse.json({
        success: false,
        message: `직무지도원 한도(${quotaCheck.max}명)에 도달했습니다. 플랜을 업그레이드해주세요.`,
        reason: "QUOTA_EXCEEDED",
      }, { status: 403 });
    }

    // ─── 사업주(갑) 정보: 미입력 시 위탁기관 정보로 자동 채움(스냅샷 보존) ──
    const agencyRow = await prisma.agency.findUnique({
      where: { id: agencyId },
      select: { name: true, phoneNumber: true, address: true, representativeName: true, representativeSignatureUrl: true },
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

    // ─── 계약서 생성 ────────────────────────────────────────────
    const signToken = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7일
    const resolvedTemplateKey = isValidTemplateKey(templateKey) ? templateKey : DEFAULT_TEMPLATE_KEY;
    const resolvedTemplateData = templateData && typeof templateData === "object" ? templateData : undefined;

    const contract = await prisma.employmentContract.create({
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
        workDaysPerWeek: toInt(workDaysPerWeek),
        weeklyHoliday:  str(weeklyHoliday),
        wageType:       str(wageType),
        wageAmount:     toInt(wageAmount),
        bonusExists:    bonusExists === true,
        bonusAmount:    toInt(bonusAmount),
        extraPayExists: extraPayExists === true,
        extraPayDesc:   str(extraPayDesc),
        overtimeRate:   toInt(overtimeRate),
        wagePayday:     str(wagePayday),
        wagePayMethod:  str(wagePayMethod),
        // 사업주 스냅샷(자동채움+수정값)
        employerBizName: str(employerBizName) ?? agencyRow?.name ?? null,
        employerPhone:   str(employerPhone) ?? agencyRow?.phoneNumber ?? null,
        employerAddress: str(employerAddress) ?? agencyRow?.address ?? null,
        employerRepName: str(employerRepName) ?? agencyRow?.representativeName ?? null,
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
    });

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
    message: `안녕하세요 ${user.workerName}님,\n\nAble-Link 근로계약서 서명을 요청드립니다.\n아래 링크에서 확인 후 서명해 주세요.\n${params.contractUrl}\n\n링크는 7일간 유효합니다.\n\n급여 이체를 위해 앱 [내 정보]에서 계좌·통장사본도 등록해 주세요.`,
    buttons: [{ name: "계약서 서명하기", linkType: "WL", linkMo: params.contractUrl, linkPc: params.contractUrl }],
  });
}
