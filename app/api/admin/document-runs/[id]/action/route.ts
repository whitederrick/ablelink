// app/api/admin/document-runs/[id]/action/route.ts
// 매니저 문서 액션: confirm(확정) / sign(매니저 서명) / request-changes(수정요청).

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { audit } from "@/lib/audit";
import { PRISMA_TO_PDF_DOCTYPE } from "@/lib/docs/docTypeMap";
import { getKstDateString } from "@/lib/time";

const DOC_LABEL: Record<string, string> = {
  ATTENDANCE_SHEET:              "출근부",
  TRAINING_DAILY_LOG:            "지원고용 훈련일지",
  TRAINEE_COMPREHENSIVE_EVAL:    "훈련생 종합평가",
  POST_EMPLOY_ADAPT_LOG:         "적응지도 일지",
  ADAPTATION_COMPREHENSIVE_EVAL: "적응지도 종합평가",
  CHECKLIST:                     "체크리스트",
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const { id } = await params;
    const runId = BigInt(id);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    const run = await prisma.documentRun.findUnique({
      where: { id: runId },
      select: { id: true, agencyId: true, workerId: true, traineeId: true, assignmentId: true, signStage: true, docType: true, periodStart: true, periodEnd: true },
    });
    if (!run) return NextResponse.json({ success: false, message: "문서를 찾을 수 없습니다." }, { status: 404 });
    if (run.agencyId !== scope.agencyId) return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });

    const now = new Date();

    // 문서 식별 라벨(승인/수정요청 알림 공용): 문서명(+훈련생) · 기간
    const docLabel = DOC_LABEL[run.docType] ?? run.docType;
    let traineeName = "";
    if (run.traineeId != null) {
      const t = await prisma.trainee.findUnique({ where: { id: run.traineeId }, select: { name: true } });
      traineeName = t?.name ? `(${t.name})` : "";
    }
    // C4: periodStart/End 는 KST 자정으로 저장(예 2026-07-01T00:00+09:00 = UTC 06-30T15:00).
    //  .toISOString()은 UTC라 하루 빠른 날짜(06-30)를 줘 딥링크 기간이 어긋나고 재제출 시 원본 매칭 실패→중복 run.
    //  → KST 기준(+9h)으로 날짜 문자열 산출.
    const ps = getKstDateString(run.periodStart);
    const pe = getKstDateString(run.periodEnd);
    const docTitle = `${docLabel}${traineeName} · ${ps}~${pe}`;

    // 워커 알림 딥링크 — 해당 문서(종류·기간·훈련생·배정)로 정밀 이동. 워커 docs 페이지가 파라미터로 자동 선택.
    const linkParams = new URLSearchParams({ focusDoc: PRISMA_TO_PDF_DOCTYPE[run.docType] ?? run.docType, ps, pe });
    if (run.traineeId != null) linkParams.set("tid", run.traineeId.toString());
    // C5: 원본 run의 assignmentId를 딥링크에 포함 — 멀티현장 워커가 쿠키(다른 현장)로 엉뚱한 현장에 재제출하는 것 방지.
    if (run.assignmentId != null) linkParams.set("aid", run.assignmentId.toString());
    const workerDocLink = `/worker/docs?${linkParams.toString()}`;

    // 상태머신 가드: 제출된 문서만, 올바른 단계에서만 액션 허용(스테일 UI·중복·직접호출 방어).
    //  SUBMITTED --확정--> CONFIRMED --서명--> MANAGER_SIGNED / SUBMITTED --수정요청--> CHANGES_REQUESTED
    const stageErr = (msg: string) => NextResponse.json({ success: false, message: msg }, { status: 409 });

    if (action === "confirm") {
      // C6: read-then-update TOCTOU 방지 — 조건부 updateMany로 원자적 전이(동시 confirm 이중처리·알림 중복 차단).
      const upd = await prisma.documentRun.updateMany({ where: { id: runId, signStage: "SUBMITTED" }, data: { signStage: "CONFIRMED" } });
      if (upd.count === 0) return stageErr("이미 처리된 문서입니다. 목록을 새로고침해주세요.");
      // 워커에게 승인(확정) 알림 — 반려만 알리던 비대칭 해소.
      try {
        await prisma.workerNotice.create({
          data: {
            workerId: run.workerId,
            agencyId: run.agencyId,
            title: `[승인] ${docTitle}`,
            body: `제출하신 문서가 승인(확정)되었습니다.\n\n■ 문서: ${docTitle}`,
            type: "INFO",
            kind: "NOTICE_INDIVIDUAL",
            link: workerDocLink,
          },
        });
      } catch (e) { console.warn("[document-runs confirm] 워커 알림 실패:", e); }
      await audit(scope, { entityType: "DocumentRun", entityId: runId, action: "update", before: { signStage: run.signStage }, after: { signStage: "CONFIRMED" } });
      return NextResponse.json({ success: true, signStage: "CONFIRMED" });
    }

    if (action === "sign") {
      if (run.signStage !== "CONFIRMED") return stageErr("먼저 '확정'한 뒤 서명할 수 있습니다. 목록을 새로고침해주세요.");
      const mgr = await prisma.manager.findUnique({ where: { id: scope.managerId }, select: { signatureUrl: true, displayName: true } });
      if (!mgr?.signatureUrl)
        return NextResponse.json({ success: false, message: "등록된 매니저 서명이 없습니다. '내 서명' 메뉴에서 먼저 서명을 등록해주세요.", needSignature: true }, { status: 400 });
      // C6: CONFIRMED에서만 원자적으로 서명 전이(동시 서명/확정 경합 차단).
      const upd = await prisma.documentRun.updateMany({
        where: { id: runId, signStage: "CONFIRMED" },
        data: {
          managerSignatureUrl: mgr.signatureUrl,
          managerSignerName: mgr.displayName ?? "",
          managerSignedAt: now,
          signStage: "MANAGER_SIGNED",
        },
      });
      if (upd.count === 0) return stageErr("먼저 '확정'한 뒤 서명할 수 있습니다. 목록을 새로고침해주세요.");
      await audit(scope, { entityType: "DocumentRun", entityId: runId, action: "update", before: { signStage: run.signStage }, after: { signStage: "MANAGER_SIGNED" } });
      return NextResponse.json({ success: true, signStage: "MANAGER_SIGNED" });
    }

    if (action === "request-changes") {
      // 제출완료·확정 단계에서만 수정요청 가능(서명완료본은 재요청 대신 새 제출 유도).
      if (run.signStage !== "SUBMITTED" && run.signStage !== "CONFIRMED") return stageErr("수정요청은 제출완료·확정 상태에서만 가능합니다.");
      const reason = String(body?.reason || "").trim();
      // C6: 제출완료·확정 단계에서만 원자적으로 수정요청 전이(확정/서명과의 경합 last-write-wins 차단).
      const upd = await prisma.documentRun.updateMany({ where: { id: runId, signStage: { in: ["SUBMITTED", "CONFIRMED"] } }, data: { signStage: "CHANGES_REQUESTED" } });
      if (upd.count === 0) return stageErr("이미 처리된 문서입니다. 목록을 새로고침해주세요.");

      // P3: 상태전이(위 updateMany)는 이미 커밋됐으므로 알림 생성 실패가 요청 전체를 실패로 만들지
      //  않도록 try/catch로 감싼다(문서는 CHANGES_REQUESTED인데 500 반환되던 불일치 방지).
      try {
        await prisma.workerNotice.create({
          data: {
            workerId: run.workerId,
            agencyId: run.agencyId,
            title: `[수정요청] ${docTitle}`,
            body: `다음 문서의 수정이 필요합니다.\n\n■ 문서: ${docTitle}\n■ 사유: ${reason || "(사유 미입력)"}\n\n해당 문서를 수정 후 다시 제출해주세요.`,
            type: "WARN",
            kind: "NOTICE_INDIVIDUAL",
            link: workerDocLink,
          },
        });
      } catch (e) { console.warn("[document-runs action] 수정요청 알림 생성 실패:", e); }
      await audit(scope, { entityType: "DocumentRun", entityId: runId, action: "update", before: { signStage: run.signStage }, after: { signStage: "CHANGES_REQUESTED" } });
      return NextResponse.json({ success: true, signStage: "CHANGES_REQUESTED" });
    }

    return NextResponse.json({ success: false, message: "알 수 없는 action" }, { status: 400 });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/document-runs/[id]/action]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
