// app/api/admin/workers/[id]/route.ts
// PATCH: 직무지도원 이름·전화번호·비밀번호 수정 (어드민)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { audit, auditSnapshot } from "@/lib/audit";
import { hash } from "bcryptjs";
import { randomInt } from "crypto";

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 8 }, () => chars[randomInt(chars.length)]).join("");
}

// 자기 위탁기관 소속 직무지도원인지 확인(스코프 가드)
async function assertAgencyWorker(workerId: bigint, agencyId: bigint) {
  const worker = await prisma.worker.findFirst({
    where: { id: workerId, assignments: { some: { site: { agencyId } } } },
    select: { id: true },
  });
  return !!worker;
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
      select: { bankName: true, accountNumber: true, accountHolder: true },
    });
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

    // 자기 위탁기관 소속 직무지도원만 수정 가능
    const worker = await prisma.worker.findFirst({
      where: {
        id: workerId,
        assignments: { some: { site: { agencyId: scope.agencyId } } },
      },
      select: { id: true },
    });
    if (!worker) {
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
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: false, message: "변경할 내용이 없습니다." }, { status: 400 });
    }

    // 감사: 비밀번호 해시는 제외(민감정보)하고 변경 전 스칼라값 스냅샷(diff용)
    const { password: _pw, ...auditAfter } = updates;
    const auditBefore = await auditSnapshot("Worker", { id: workerId }, auditAfter);
    await prisma.worker.update({ where: { id: workerId }, data: updates });
    await audit(scope, { entityType: "Worker", entityId: workerId, action: "update", before: auditBefore, after: auditAfter as any });

    // 임시 비밀번호는 화면에 표시 → 매니저가 직무지도원에게 직접 안내(외부 발송 0건, 무료).
    // 고령 사용자 비번 분실이 잦아 SMS 건당 과금을 피하기 위한 주 동선.
    return NextResponse.json({ success: true, passwordReset: !!tempPassword, tempPassword });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin workers PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
