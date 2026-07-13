// app/api/admin/workers/[id]/route.ts
// PATCH: 직무지도원 이름·전화번호·비밀번호 수정 (어드민)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { audit, auditSnapshot } from "@/lib/audit";
import { logAccess } from "@/lib/accessLog";
import { hash } from "bcryptjs";
import { randomInt } from "crypto";
import { workerBelongsToAgency } from "@/lib/worker/agencyScope";

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 8 }, () => chars[randomInt(chars.length)]).join("");
}

// 자기 위탁기관 소속 직무지도원인지 확인(스코프 가드) — ★13차: 공용 판정(수락/근무한 배정 또는 계약이력)으로 위임.
//  status 없는 assignments.some({site:{agencyId}})는 미동의 REQUESTED 위장 계정탈취(P0)에 뚫렸음.
async function assertAgencyWorker(workerId: bigint, agencyId: bigint) {
  return workerBelongsToAgency(workerId, agencyId);
}

// GET: 직무지도원 상세(급여 계좌)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scope = await requireManagerSession(req);
    const { id } = await params;
    const workerId = BigInt(id);
    if (!(await assertAgencyWorker(workerId, scope.agencyId))) {
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    }
    const w = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { workerName: true, bankName: true, accountNumber: true, accountHolder: true },
    });
    // 개인정보 접속기록 — 급여계좌 열람
    await logAccess(req, scope, { subjectType: "Worker", subjectId: workerId, subjectLabel: w?.workerName ?? null, resource: "account" });
    return NextResponse.json({
      success: true,
      data: {
        bankName: w?.bankName ?? null,
        accountNumber: w?.accountNumber ?? null,
        accountHolder: w?.accountHolder ?? null,
      },
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin workers GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scope = await requireManagerSession(req);

    const { id } = await params;
    const workerId = BigInt(id);

    // 자기 위탁기관 소속 직무지도원만 수정 가능 — ★13차: 공용 판정(CONSENTED 상태/계약)으로 통일.
    if (!(await assertAgencyWorker(workerId, scope.agencyId))) {
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    }

    const body = await req.json();
    const { workerName, phoneNumber, resetPassword, bankName, accountNumber, accountHolder, birthDate } = body;

    const updates: Record<string, any> = {};

    if (workerName?.trim()) updates.workerName = workerName.trim();

    // 생년월일(YYYY-MM-DD, 빈 값=null) — 근로계약서(07/06) 등에 사용되는 단일 출처
    if (birthDate !== undefined) {
      const b = typeof birthDate === "string" && birthDate.trim() ? birthDate.trim() : null;
      if (b && !/^\d{4}-\d{2}-\d{2}$/.test(b)) {
        return NextResponse.json({ success: false, message: "생년월일 형식이 올바르지 않습니다. (YYYY-MM-DD)" }, { status: 400 });
      }
      updates.birthDate = b;
    }

    // 급여 계좌 보완(매니저 입력) — 빈 문자열은 null
    const bankStr = (v: any): string | null | undefined =>
      v === undefined ? undefined : (typeof v === "string" && v.trim() ? v.trim() : null);
    if (bankName !== undefined)      updates.bankName = bankStr(bankName);
    if (accountNumber !== undefined) updates.accountNumber = bankStr(accountNumber);
    if (accountHolder !== undefined) updates.accountHolder = bankStr(accountHolder);

    if (phoneNumber) {
      const cleaned = String(phoneNumber).replace(/-/g, "");
      if (!/^01[0-9]{8,9}$/.test(cleaned)) {
        return NextResponse.json({ success: false, message: "올바른 전화번호 형식이 아닙니다." }, { status: 400 });
      }
      const dup = await prisma.worker.findFirst({
        where: { phoneNumber: { in: [phoneNumber, cleaned] }, id: { not: workerId } },
      });
      if (dup) return NextResponse.json({ success: false, message: "이미 사용 중인 전화번호입니다." }, { status: 409 });
      updates.phoneNumber = phoneNumber;
    }

    let tempPassword: string | null = null;
    if (resetPassword) {
      tempPassword         = generateTempPassword();
      updates.password     = await hash(tempPassword, 12);
      updates.isTemporary  = true;
      // ★10차#3: 매니저가 부여한 재설정 비번은 워커에게 구두 전달되는 known 비번. hasKnownPassword=true로 전이해
      //  계약 서명 분기(worker/contracts:284)가 이 비번을 랜덤값으로 덮어쓰지 않게 한다(초대출신 워커 락아웃 방지).
      updates.hasKnownPassword = true;
      // ★비밀번호 초기화 = 전 세션 로그아웃(셀프 재설정 reset-password와 동일 정책, P2-16).
      //  sv를 올리지 않으면 기존 발급 JWT(sv 일치)가 계속 통과 → 초기화해도 세션 회수 안 됨.
      updates.sessionVersion = { increment: 1 };
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: false, message: "변경할 내용이 없습니다." }, { status: 400 });
    }

    // 감사: 비밀번호 해시는 제외(민감정보)하고 변경 전 스칼라값 스냅샷(diff용)
    const { password: _pw, ...auditAfter } = updates;
    const auditBefore = await auditSnapshot("Worker", { id: workerId }, auditAfter);
    await prisma.worker.update({ where: { id: workerId }, data: updates });
    await audit(scope, { entityType: "Worker", entityId: workerId, action: "update", before: auditBefore, after: auditAfter });

    // 임시 비밀번호는 화면에 표시 → 매니저가 직무지도원에게 직접 안내(외부 발송 0건, 무료).
    // 고령 사용자 비번 분실이 잦아 SMS 건당 과금을 피하기 위한 주 동선.
    return NextResponse.json({ success: true, passwordReset: !!tempPassword, tempPassword });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin workers PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
