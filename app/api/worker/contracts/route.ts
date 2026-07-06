// app/api/worker/contracts/route.ts
// 직무지도원 계약서 조회 및 서명 API

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendAlimtalk } from "@/lib/kakao";
import { getAcknowledgement } from "@/lib/contractTemplates";
import { imageToDataUri } from "@/lib/signatureImage";
import { findTimeConflict } from "@/lib/assignmentOverlap";
import { hash } from "bcryptjs";
import { randomInt } from "crypto";

const WORK_TYPE_LABELS: Record<string, string> = {
  AM:       "오전 4시간 (09:00~12:00)",
  PM:       "오후 4시간 (13:00~17:00)",
  FULL_DAY: "전일 8시간 (09:00~18:00)",
  CUSTOM:   "직접 지정",
};

// GET: 토큰으로 계약서 조회 (비로그인 허용 — 카카오 링크 접근)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ success: false, message: "토큰이 없습니다." }, { status: 400 });
  }

  const contract = await prisma.employmentContract.findUnique({
    where: { signToken: token },
    include: {
      user: { select: { workerName: true, phoneNumber: true, signatureUrl: true } },
      agency: { select: { name: true, address: true, phoneNumber: true } },
    },
  });

  if (!contract) {
    return NextResponse.json({ success: false, message: "유효하지 않은 링크입니다." }, { status: 404 });
  }

  if (new Date() > contract.tokenExpiresAt) {
    return NextResponse.json({ success: false, message: "만료된 링크입니다. 관리자에게 재발급을 요청하세요." }, { status: 410 });
  }

  const workTypeLabel = contract.workType ? (WORK_TYPE_LABELS[contract.workType] ?? contract.workType) : "미정";
  const customTimeStr = contract.workType === "CUSTOM" && contract.customWorkStart && contract.customWorkEnd
    ? ` (${contract.customWorkStart}~${contract.customWorkEnd})`
    : "";

  return NextResponse.json({
    success: true,
    data: {
      id: String(contract.id),
      status: contract.status,
      workerName: contract.user.workerName,
      workerPhone: contract.user.phoneNumber,
      agencyName: contract.agency.name,
      agencyAddress: contract.agency.address,
      agencyPhone: contract.agency.phoneNumber,
      contractStart: contract.contractStart.toISOString().slice(0, 10),
      contractEnd: contract.contractEnd.toISOString().slice(0, 10),
      siteName: contract.siteName,
      workTypeLabel: workTypeLabel + customTimeStr,
      commuteGuidanceIncluded: contract.commuteGuidanceIncluded,
      // ── 표준양식 항목 ──
      workLocation: contract.workLocation,
      jobDescription: contract.jobDescription,
      workStartTime: contract.workStartTime,
      workEndTime: contract.workEndTime,
      breakStartTime: contract.breakStartTime,
      breakEndTime: contract.breakEndTime,
      workDaysPerWeek: contract.workDaysPerWeek,
      weeklyHoliday: contract.weeklyHoliday,
      wageType: contract.wageType,
      wageAmount: contract.wageAmount,
      bonusExists: contract.bonusExists,
      bonusAmount: contract.bonusAmount,
      extraPayExists: contract.extraPayExists,
      extraPayDesc: contract.extraPayDesc,
      overtimeRate: contract.overtimeRate,
      wagePayday: contract.wagePayday,
      wagePayMethod: contract.wagePayMethod,
      employerBizName: contract.employerBizName || contract.agency.name,
      employerPhone: contract.employerPhone || contract.agency.phoneNumber,
      employerAddress: contract.employerAddress || contract.agency.address,
      employerRepName: contract.employerRepName,
      workerAddress: contract.workerAddress,
      specialClauses: Array.isArray(contract.specialClauses) ? contract.specialClauses : [],
      // 직무지도원이 직접 입력한 내용 (관리자가 미입력 시)
      workerFilledSiteName: contract.workerFilledSiteName,
      workerFilledWorkType: contract.workerFilledWorkType,
      workerFilledAddress: contract.workerFilledAddress,
      workerSignedAt: contract.workerSignedAt?.toISOString() ?? null,
      adminSignedAt: contract.adminSignedAt?.toISOString() ?? null,
      workerSignatureUrl: contract.workerSignatureUrl,
      // 양식 — 07 성동은 제3조⑧ '듣고 인지함' 손글씨 입력 필요
      templateKey: (contract as any).templateKey ?? "STANDARD",
      // 프로필에 저장된 전자서명 — 있으면 서명란에 자동 채움(다시 그리기 가능)
      //  서명 버킷 private 대응: base64 data URI로 반환(표시 + 재사용 제출 모두 가능).
      savedSignatureUrl: (await imageToDataUri(contract.user.signatureUrl)) ?? null,
    },
  });
}

// POST: 직무지도원 서명 처리
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token, signatureUrl, workerFilledSiteName, workerFilledWorkType, workerFilledAddress, heardHandwritingUrl } = body;

  if (!token || !signatureUrl) {
    return NextResponse.json({ success: false, message: "필수 항목이 없습니다." }, { status: 400 });
  }
  // 듣고 인지함 손글씨(07 성동) — 있으면 형식·크기 검증
  if (heardHandwritingUrl != null) {
    if (typeof heardHandwritingUrl !== "string" || !heardHandwritingUrl.startsWith("data:image/")) {
      return NextResponse.json({ success: false, message: "잘못된 손글씨 형식입니다." }, { status: 400 });
    }
    if (heardHandwritingUrl.length > 2 * 1024 * 1024) {
      return NextResponse.json({ success: false, message: "손글씨 이미지가 너무 큽니다." }, { status: 400 });
    }
  }
  if (typeof token !== "string" || token.length > 128) {
    return NextResponse.json({ success: false, message: "잘못된 토큰입니다." }, { status: 400 });
  }
  if (!signatureUrl.startsWith("data:image/")) {
    return NextResponse.json({ success: false, message: "잘못된 서명 형식입니다." }, { status: 400 });
  }
  if (signatureUrl.length > 2 * 1024 * 1024) {
    return NextResponse.json({ success: false, message: "서명 이미지가 너무 큽니다." }, { status: 400 });
  }
  if (workerFilledSiteName && (typeof workerFilledSiteName !== "string" || workerFilledSiteName.length > 200)) {
    return NextResponse.json({ success: false, message: "사업체명이 너무 깁니다." }, { status: 400 });
  }
  if (workerFilledWorkType && (typeof workerFilledWorkType !== "string" || workerFilledWorkType.length > 100)) {
    return NextResponse.json({ success: false, message: "근무형태 값이 너무 깁니다." }, { status: 400 });
  }
  if (workerFilledAddress && (typeof workerFilledAddress !== "string" || workerFilledAddress.length > 200)) {
    return NextResponse.json({ success: false, message: "주소가 너무 깁니다." }, { status: 400 });
  }

  const contract = await prisma.employmentContract.findUnique({
    where: { signToken: token },
  });

  if (!contract) {
    return NextResponse.json({ success: false, message: "유효하지 않은 링크입니다." }, { status: 404 });
  }

  if (new Date() > contract.tokenExpiresAt) {
    return NextResponse.json({ success: false, message: "만료된 링크입니다." }, { status: 410 });
  }

  if (contract.status !== "PENDING") {
    return NextResponse.json({ success: false, message: "이미 서명이 완료된 계약서입니다." }, { status: 409 });
  }

  // 양식이 '듣고 인지함' 손글씨를 요구하면 필수. (양식 정의 기반 — 신규 양식 추가 시 설정만으로 동작)
  const ack = getAcknowledgement((contract as any).templateKey);
  if (ack && !heardHandwritingUrl) {
    return NextResponse.json({ success: false, message: `'${ack.guideText}' 손글씨 작성이 필요합니다.` }, { status: 400 });
  }
  // templateData 병합(기존 값 보존 + 손글씨 저장)
  const mergedTemplateData = heardHandwritingUrl
    ? { ...((contract as any).templateData && typeof (contract as any).templateData === "object" ? (contract as any).templateData : {}), heardHandwritingUrl }
    : undefined;

  const user = await prisma.worker.findUnique({
    where: { id: contract.workerId },
    select: { workerName: true, phoneNumber: true, isTemporary: true },
  });

  await prisma.employmentContract.update({
    where: { id: contract.id },
    data: {
      status: "SIGNED",
      workerSignedAt: new Date(),
      workerSignatureUrl: signatureUrl,
      workerFilledSiteName: workerFilledSiteName || null,
      workerFilledWorkType: workerFilledWorkType || null,
      workerFilledAddress: workerFilledAddress || null,
      ...(mergedTemplateData ? { templateData: mergedTemplateData } : {}),
    },
  });

  // ── 계약 ↔ 배정 write-back (assignment-pipeline-design.md §6) ──
  // 연결된 배정이 있으면 계약 근무정보를 배정으로 반영하고 ASSIGNED→CONFIRMED(연결 대기)로 전이.
  // ACTIVE 배정은 강등하지 않도록 status 가드.
  if (contract.assignmentId) {
    const isFullDay = contract.workType === "FULL_DAY";
    const isCustom  = contract.workType === "CUSTOM";
    // E1: 서명 시 workType/기간을 배정에 덮어쓰며 CONFIRMED로 승격하는데, 겹침가드 없이 하면
    //  respond/PATCH/offers의 409를 우회해 이중배정(AM+FULL_DAY 등)이 생긴다.
    //  → 계약 workType·기간을 후보로 같은 워커의 다른 진행중 배정과 시간겹침을 검사, 충돌 시 승격 보류 + 알림.
    const others = await prisma.siteAssignment.findMany({
      where: {
        workerId: contract.workerId,
        // M3: 같은 기관 배정만 대상 — PATCH(W#2)와 통일. 스코프 없으면 타 기관 배정이 계약 확정을 영구 차단(해소 불가).
        agencyId: contract.agencyId,
        status: { in: ["ACCEPTED", "ASSIGNED", "CONFIRMED", "ACTIVE"] },
        NOT: { id: contract.assignmentId },
      },
      select: { id: true, workType: true, customWorkStart: true, customWorkEnd: true, startDate: true, endDate: true, site: { select: { companyName: true } } },
    });
    const conflict = findTimeConflict(
      { workType: contract.workType, customWorkStart: isCustom ? contract.customWorkStart : null, customWorkEnd: isCustom ? contract.customWorkEnd : null, startDate: contract.contractStart, endDate: contract.contractEnd },
      others,
    );
    if (conflict) {
      // 이중배정 방지: 승격/덮어쓰기 보류. 매니저에게 일정 충돌 알림(수동 해소 유도).
      if (contract.agencyId) {
        try {
          const mgrs = await prisma.manager.findMany({ where: { agencyId: contract.agencyId, isActive: true }, select: { id: true } });
          if (mgrs.length) await prisma.managerNotice.createMany({
            data: mgrs.map((m) => ({
              managerId: m.id,
              title: "[일정 충돌] 계약 서명 — 배정 확정 보류",
              body: `계약 근무형태·기간이 '${conflict.site?.companyName ?? "다른 현장"}' 배정과 같은 날 근무시간이 겹쳐 배정 확정(CONFIRMED)을 보류했습니다.\n배정 관리에서 일정을 조정한 뒤 확정해 주세요.`,
              link: "/manager/workers",
            })),
          });
        } catch { /* 알림 실패는 서명 흐름에 영향 없음 */ }
      }
    } else {
      await prisma.siteAssignment.updateMany({
        where: { id: contract.assignmentId, status: { in: ["ASSIGNED", "CONFIRMED"] } },
        data: {
          workType: contract.workType ?? undefined,
          commuteGuidanceIncluded: isFullDay ? false : contract.commuteGuidanceIncluded,
          customWorkStart: isCustom ? contract.customWorkStart : null,
          customWorkEnd:   isCustom ? contract.customWorkEnd   : null,
          startDate: contract.contractStart,
          endDate:   contract.contractEnd,
          status:    "CONFIRMED",
          confirmedAt: new Date(),
        },
      });
    }
  }

  // ── 급여 기준 자동 생성 (1단계-②) ──
  // 계약 임금정보(시급/급여형태/기간)로 급여 기준을 시드. 이미 겹치는 급여 기준이 있으면 건너뜀.
  // 소득유형·내부외부는 저장값과 무관(급여 계산 시 자동 판정). 실패해도 서명엔 영향 없음.
  try {
    const wt = contract.wageType;
    if (contract.agencyId && contract.wageAmount != null && (wt === "HOURLY" || wt === "DAILY" || wt === "MONTHLY")) {
      const existingPay = await prisma.payContract.findFirst({
        where: {
          // 기관 기본 계약(siteId=null)만 존재확인 대상 — 현장 override만 있는 고아 상태에서
          //  기본계약 시딩이 건너뛰어지지 않도록(A3). 시드 create는 siteId 미지정=null(기본).
          agencyId: contract.agencyId, workerId: contract.workerId, siteId: null,
          effectiveFrom: { lte: contract.contractEnd },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: contract.contractStart } }],
        } as any,
        select: { id: true },
      });
      if (!existingPay) {
        const base = contract.wageAmount;
        const payData: any = {
          agencyId: contract.agencyId,
          workerId: contract.workerId,
          workerType: "EXTERNAL",
          payType: wt,
          baseAmount: base,
          incomeType: "EMPLOYMENT",
          hourlyRate2Plus: wt === "HOURLY" ? Math.round(base * 1.2) : null,
          weeklyHolidayPay: wt === "HOURLY" ? Math.round(base * 8) : null,
          effectiveFrom: contract.contractStart,
          effectiveTo: contract.contractEnd,
        };
        await prisma.payContract.create({ data: payData });
      }
    }
  } catch (e) {
    console.warn("[worker/contracts] 급여 기준 자동 생성 실패:", e);
  }

  // 서명 완료 후 연결(assignment-pipeline-design.md §7) — 신규/기존 분기. 실패해도 서명엔 영향 없음.
  try {
    if (user?.isTemporary) {
      // 신규 가입자: 임시 비밀번호 발급 → 알림톡(자격증명 전달). 로그인=연결이므로 배정 connectedAt 기록.
      await sendSignedNotificationNew(contract.workerId, user.phoneNumber, user.workerName);
      if (contract.assignmentId) {
        const asg = await prisma.siteAssignment.findUnique({ where: { id: contract.assignmentId }, select: { attendanceButtonExempt: true } });
        await prisma.siteAssignment.updateMany({
          where: { id: contract.assignmentId, connectedAt: null },
          data: { connectedAt: new Date() },
        });
        // 면제(자동 기록) 배정은 위치확정 단계가 없으므로 연결 시 바로 ACTIVE
        if (asg?.attendanceButtonExempt) {
          await prisma.siteAssignment.updateMany({
            where: { id: contract.assignmentId, status: "CONFIRMED" },
            data: { status: "ACTIVE" },
          });
        }
      }
    } else if (contract.assignmentId && contract.agencyId) {
      // 기존 회원 + 연결 배정: 인증코드 발송 → 앱에서 코드 입력으로 배정 연결(connectedAt).
      await sendConnectCodeExisting(
        contract.workerId, contract.assignmentId, contract.agencyId,
        contract.createdByManagerId, user?.phoneNumber ?? "", user?.workerName ?? "직무지도원",
      );
    } else if (contract.agencyId) {
      // 연결 배정 없는 기존 회원(단순 재계약 등): 서명 완료 안내(앱 내 알림).
      await prisma.workerNotice.create({
        data: {
          workerId: contract.workerId,
          agencyId: contract.agencyId,
          title: "근로계약서 서명 완료",
          body: "새 근로계약서 서명이 완료되었습니다. 문서 메뉴에서 확인할 수 있어요.",
          type: "INFO",
        },
      });
    }
  } catch (e) {
    console.error("[contracts sign] 서명 완료 연결 처리 실패:", e);
  }

  return NextResponse.json({ success: true, message: "서명이 완료되었습니다." });
}

// ─── 읽기 쉬운 임시 비밀번호 생성 (crypto.randomInt — 예측 불가) ──
function generateTempPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789"; // 혼동 문자(0/O, 1/l/I) 제외
  return Array.from({ length: 8 }, () => chars[randomInt(chars.length)]).join("");
}

// ─── 신규 직무지도원 서명 완료 알림 (임시 비밀번호 발급) ──────────
async function sendSignedNotificationNew(workerId: bigint, phone: string, name: string) {
  const templateCode = process.env.KAKAO_SIGNUP_TEMPLATE_CODE;
  const appUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://able-link.co.kr";
  const loginId = phone.replace(/-/g, "");

  if (!templateCode) {
    console.warn("[contracts sign] KAKAO_SIGNUP_TEMPLATE_CODE 미설정 — 임시 비밀번호 발급 건너뜀");
    return;
  }

  const tempPassword = generateTempPassword();
  await prisma.worker.update({ where: { id: workerId }, data: { password: await hash(tempPassword, 12) } });

  await sendAlimtalk({
    phone, name, templateCode,
    subject: "Able-Link 가입 안내",
    message: `안녕하세요 ${name}님,\n\n근로계약서 서명이 완료되었습니다.\nAble-Link 서비스를 이용하시려면 아래 정보로 로그인해 주세요.\n\n아이디: ${loginId} (전화번호)\n임시 비밀번호: ${tempPassword}\n\n첫 로그인 후 비밀번호를 변경해 주세요. (아이디는 전화번호이며, 원하면 이메일로 변경할 수 있습니다.)`,
    buttons: [{ name: "로그인하기", linkType: "WL", linkMo: `${appUrl}/worker/login`, linkPc: `${appUrl}/worker/login` }],
  });
}

// ─── 기존 직무지도원 배정 연결 인증코드 발송(assignment-pipeline-design.md §7) ──────────
// 이미 가입된 유저는 임시비번 대신 인증코드를 받아 앱에서 입력 → 배정 연결(connectedAt).
async function sendConnectCodeExisting(
  workerId: bigint, assignmentId: bigint, agencyId: bigint,
  createdByManagerId: bigint | null, phone: string, name: string,
) {
  const code = String(randomInt(100000, 1000000)); // 6자리
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7일

  // 연결 토큰은 매니저 소속 필요 — 부재 시(운영자 발행 등) 같은 위탁기관 매니저로 폴백
  let managerId = createdByManagerId;
  if (managerId == null) {
    const m = await prisma.manager.findFirst({ where: { agencyId }, select: { id: true } });
    managerId = m?.id ?? null;
  }
  if (managerId == null) {
    await prisma.workerNotice.create({
      data: { workerId, agencyId, title: "새 배정 연결", body: "근로계약이 완료되었습니다. 담당자에게 연결 인증코드를 요청해 주세요.", type: "INFO" },
    });
    return;
  }

  await prisma.workerInvite.create({
    data: {
      agencyId, assignmentId, existingWorkerId: workerId,
      purpose: "CONNECT_EXISTING",
      phoneNumber: phone, workerName: name, code, expiresAt,
      createdByManagerId: managerId,
    },
  });

  const templateCode = process.env.KAKAO_ASSIGN_CONNECT_TEMPLATE_CODE;
  const appUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://able-link.co.kr";
  if (templateCode && phone) {
    await sendAlimtalk({
      phone, name, templateCode,
      subject: "Able-Link 배정 연결 인증코드",
      message: `안녕하세요 ${name}님,\n\n근로계약이 완료되어 새 현장 배정 연결이 필요합니다.\n앱에서 아래 인증코드를 입력해 주세요.\n\n인증코드: ${code}\n(유효기간 7일)`,
      buttons: [{ name: "배정 연결하기", linkType: "WL", linkMo: `${appUrl}/worker/connect`, linkPc: `${appUrl}/worker/connect` }],
    });
  } else {
    // 템플릿 미등록 폴백: 앱 내 알림으로 코드 전달(무료)
    await prisma.workerNotice.create({
      data: { workerId, agencyId, title: "새 배정 연결 인증코드", body: `새 현장 배정 연결 인증코드: ${code} (앱 > 배정 연결에서 입력, 유효 7일)`, type: "INFO" },
    });
  }
}

