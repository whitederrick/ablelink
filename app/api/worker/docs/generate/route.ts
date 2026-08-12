// app/api/worker/docs/generate/route.ts
// PDF 생성 + Resend 이메일 발송 (PREMIUM 전용)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { isValidYmd } from "@/lib/time";
import { checkPlanAccess } from "@/lib/planGuard";
import { getPilotAssignmentState } from "@/lib/pilot/capability";
import { prisma } from "@/lib/prisma";
import { renderPdfToBuffer } from "@/lib/pdf";
import { buildDocFileName } from "@/lib/pdf/filename";
import { sendEmailWithPdf } from "@/lib/email";
import { getKrHolidayDates } from "@/lib/krHolidays";
import { dailyDocTimes } from "@/lib/pdf/dailyDocTimes";
import { buildAttendanceSheetPayload } from "@/lib/docs/attendanceSheetPayload";
import { trainingDailyLogPayload, traineeFinalEvalPayload, adaptationDailyLogPayload, adaptationFinalEvalPayload } from "@/lib/docs/traineeDocPayload";
import { resolveDocAssignment } from "@/lib/docs/resolveDocAssignment";
import { findTraineeAtSiteInPeriod } from "@/lib/docs/traineeSiteGuard";
import { imageToDataUri } from "@/lib/signatureImage";
import { checkRateLimit } from "@/lib/rateLimit";

// 간단·보수적 이메일 형식 검증(발신 남용·오발송 방지용). RFC 완벽 준수보다 명백한 오입력 차단이 목적.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── 유틸 ──────────────────────────────────────────────────────

const DOC_LABELS: Record<string, string> = {
  "ATTENDANCE_SHEET":      "직무지도원 출근부",
  "TRAINING_DAILY_LOG":    "지원고용 훈련일지",
  "TRAINEE_FINAL_EVAL":    "지원고용 훈련생 종합 평가기록부",
  "ADAPTATION_DAILY_LOG":  "취업 후 적응지도 일지",
  "ADAPTATION_FINAL_EVAL": "적응지도 대상자 종합 평가기록부",
};

// ── 메인 핸들러 ───────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });

    const workerId = BigInt(session.workerId);
    const planCheck = await checkPlanAccess(workerId, "PDF_GENERATE");
    if (!planCheck.allowed) return NextResponse.json({ success: false, message: planCheck.message }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const { docType, periodStart, periodEnd, sendEmail, toEmail, traineeId, companyManagerSignToken, assignmentId } = body;

    if (!docType) return NextResponse.json({ success: false, message: "문서 종류를 선택해주세요." }, { status: 400 });
    // 날짜 왕복검증(submit·preview·admin generate와 통일) — 실존불가 날짜가 findTraineeAtSiteInPeriod의 Invalid Date로 500나던 것 차단.
    if (!isValidYmd(String(periodStart)) || !isValidYmd(String(periodEnd)))
      return NextResponse.json({ success: false, message: "기간(YYYY-MM-DD)이 올바르지 않습니다." }, { status: 400 });
    // traineeId는 훈련생 문서에서 BigInt로 쓰임 — 비숫자면 500 대신 400(P3 위생).
    if (traineeId != null && !/^\d+$/.test(String(traineeId))) return NextResponse.json({ success: false, message: "잘못된 훈련생 ID입니다." }, { status: 400 });

    // ★2026-07-21 감사 P2: PDF 생성은 CPU를, 이메일 발송은 외부(Resend) 비용·발신 도메인 평판을 소모한다.
    //  종전엔 toEmail을 형식검증·상한 없이 Able-Link 명의로 임의 주소에 발송 가능(스팸·평판 훼손 표면). 이중 방어:
    //  ① 생성 자체에 완만한 상한(PDF CPU 폭주 방어) ② 발송에는 형식검증 + 더 엄격한 상한.
    const genRl = await checkRateLimit(`doc-gen:${workerId}`, { max: 30, windowSec: 60, blockSec: 60 });
    if (!genRl.allowed) return NextResponse.json({ success: false, message: "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
    if (sendEmail && toEmail) {
      if (typeof toEmail !== "string" || !EMAIL_RE.test(toEmail.trim())) {
        return NextResponse.json({ success: false, message: "받는사람 이메일 형식이 올바르지 않습니다." }, { status: 400 });
      }
      const sendRl = await checkRateLimit(`doc-send:${workerId}`, { max: 10, windowSec: 3600, blockSec: 600 });
      if (!sendRl.allowed) return NextResponse.json({ success: false, message: "이메일 발송이 너무 잦습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
    }

    // 멀티현장: 클라가 선택 배정(assignmentId)을 주면 그 현장으로 생성(소유 검증). 없으면 최신 1건 폴백.
    let selAssignmentId: bigint | null = null;
    try { selAssignmentId = assignmentId ? BigInt(assignmentId) : null; } catch { selAssignmentId = null; }

    // ── 기본 데이터 조회 ────────────────────────────────────
    const user = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { workerName: true, phoneNumber: true, signatureUrl: true, loginId: true },
    });

    // 배정 결정은 단일 출처(resolveDocAssignment) — preview/submit과 통일. 명시배정 유효→사용(ENDED 포함),
    //  없/무효면 활성1개→폴백·활성2개+→선택유도(409)·활성0개→최근ENDED(마감서류).
    const resolved = await resolveDocAssignment(workerId, selAssignmentId, { include: { site: true } });
    if (resolved.status === "ambiguous") {
      return NextResponse.json({ success: false, code: "SELECT_SITE", message: "여러 현장에 배정되어 있습니다. 현장을 선택한 뒤 다시 시도해주세요." }, { status: 409 });
    }
    const assignment = resolved.status === "resolved" ? resolved.assignment : null;
    if (!assignment?.site) return NextResponse.json({ success: false, message: "배정된 현장이 없습니다." }, { status: 400 });

    const site = assignment.site;
    const start = periodStart || new Date().toISOString().slice(0,10);
    const end   = periodEnd   || new Date().toISOString().slice(0,10);

    // ─────────────────────────────────────────────────────────────────────────
    // ★[PILOT] 파일럿 전용 차단 — 회차 종료 시 **이 블록과 위 import 1줄**(getPilotAssignmentState)만
    //  지우면 원복된다. 플랜 게이트(checkPlanAccess)를 포함한 기존 판정은 한 줄도 건드리지 않았다.
    // ─────────────────────────────────────────────────────────────────────────
    // ★파일럿 문서는 이메일로 내보내지 않는다(v1.8 §3.2 제외항목).
    //  PDF 생성·로컬 다운로드는 그대로 허용이라 요청 전체를 막지 않고 '발송 요청'만 거부한다.
    //  ★비용: sendEmail을 명시한 요청에서만 조회한다 — 발송 안 하는 기존 요청은 쿼리가 늘지 않는다.
    if (sendEmail && (await getPilotAssignmentState(assignment.id)).isPilot) {
      return NextResponse.json(
        { success: false, message: "파일럿 문서는 이메일로 발송할 수 없습니다. PDF를 내려받아 사용해주세요.", reason: "PILOT_SEND_BLOCKED" },
        { status: 403 },
      );
    }
    // ★[PILOT] 끝

    // 일지 PDF용 근무형태 고정 시간값(훈련시간/측정시간/근무시간/Y·N) — 단일 출처
    const docTimes = dailyDocTimes(
      assignment.workType,
      assignment.commuteGuidanceIncluded,
      assignment.customWorkStart,
      assignment.customWorkEnd,
    );

    // ── 사업체담당자 즉석 서명 확인 ────────────────────────
    let companyManagerSignatureUrl: string | null = null;
    let companyManagerSignerName = "";
    if (companyManagerSignToken) {
      const tokenRec = await prisma.siteSignToken.findUnique({
        where: { token: companyManagerSignToken },
        select: { signatureUrl: true, usedAt: true, signRole: true, signerName: true, assignmentId: true, periodStart: true, periodEnd: true },
      });
      // ★토큰이 '이 문서의 배정·기간'에 발급된 것인지 검증 — 다른 현장/기간 서명 오귀속 방지(CD1).
      if (tokenRec?.usedAt && tokenRec.signRole === "company_manager"
          && tokenRec.assignmentId === assignment.id
          && tokenRec.periodStart === start && tokenRec.periodEnd === end) {
        companyManagerSignatureUrl = tokenRec.signatureUrl;
        companyManagerSignerName   = tokenRec.signerName || "";
      }
    }

    // 명시적 토큰 없을 때 같은 기간의 최근 서명 자동 조회
    if (!companyManagerSignatureUrl) {
      const recentToken = await prisma.siteSignToken.findFirst({
        where: {
          assignmentId: assignment.id,
          periodStart:  start,
          periodEnd:    end,
          signRole:     "company_manager",
          usedAt:       { not: null },
        },
        orderBy: { usedAt: "desc" },
      });
      if (recentToken) {
        companyManagerSignatureUrl = recentToken.signatureUrl;
        companyManagerSignerName   = recentToken.signerName || "";
      }
    }

    // 위탁기관 관리자 서명은 관리자가 명시적으로 서명 후 첨부 — 여기서는 자동 삽입 안 함
    const [workerImg, companyImg] = await Promise.all([
      imageToDataUri(user?.signatureUrl),
      imageToDataUri(companyManagerSignatureUrl),
    ]);

    const sigs = {
      worker:          { name: user?.workerName || "",        imageUrl: workerImg },
      govAgent:       { name: "",                          imageUrl: undefined as string | undefined },
      companyManager: { name: companyManagerSignerName,    imageUrl: companyImg },
      agencyAgent:    { name: "",                          imageUrl: undefined as string | undefined },
    };

    // ── 문서별 payload 빌드 ──────────────────────────────────
    let payload: any;
    let fileName: string;

    if (docType === "ATTENDANCE_SHEET") {
      ({ payload, fileName } = await buildAttendanceSheetPayload({
        workerId,
        start, end,
        siteId: site.id,
        companyName: site.companyName,
        workerName: user?.workerName || "",
        workerPhone: user?.phoneNumber || user?.loginId || "",
        fallbackAssignment: {
          workType: assignment.workType ?? null,
          commuteGuidanceIncluded: assignment.commuteGuidanceIncluded ?? null,
          customWorkStart: assignment.customWorkStart ?? null,
          customWorkEnd: assignment.customWorkEnd ?? null,
          attendanceButtonExempt: assignment.attendanceButtonExempt ?? null,
        },
        signatures: { govAgent: sigs.govAgent, companyManager: sigs.companyManager, worker: sigs.worker },
      }));

    } else if (docType === "TRAINING_DAILY_LOG") {
      if (!traineeId) return NextResponse.json({ success: false, message: "훈련생을 선택해주세요." }, { status: 400 });

      const trainee = await findTraineeAtSiteInPeriod(BigInt(traineeId), site.id, start, end); // IDOR 방지: 배정 현장+기간 재적 훈련생만
      if (!trainee) return NextResponse.json({ success: false, message: "해당 기간에 이 현장 소속이 아닌 훈련생입니다." }, { status: 400 });
      const logs = await prisma.traineeLog.findMany({
        where: {
          writerId: workerId, traineeId: BigInt(traineeId),
          trainingType: { in: ["PRE","FIELD"] },
          attendance: { siteId: site.id, workDate: { gte: start, lte: end } },
        },
        include: { attendance: true, tasks: true },
        orderBy: { attendance: { workDate: "asc" } },
      });

      // 자동 생성 행에서 제외할 휴무일 = 한국 공휴일 + 현장 커스텀 휴무(근무 미인정)
      const preStart = assignment.stepStart?.toISOString().slice(0, 10) || start;
      const siteHols = await prisma.siteHoliday.findMany({
        where: { assignmentId: assignment.id, countAsWorkday: false },
        select: { date: true },
      });
      const holidays = [...new Set([...getKrHolidayDates(preStart, end), ...siteHols.map(h => h.date)])];

      payload = trainingDailyLogPayload({
        traineeName: trainee?.name || "", companyName: site.companyName,
        preStartYmd: assignment.stepStart?.toISOString().slice(0, 10) || start,
        start, end, logs, docTimes, holidays,
        signatures: { govAgent: sigs.govAgent, companyManager: sigs.companyManager, worker: sigs.worker },
      });
      fileName = buildDocFileName("TRAINING_DAILY_LOG", { traineeName: trainee?.name, companyName: site.companyName, start, end });

    } else if (docType === "TRAINEE_FINAL_EVAL") {
      if (!traineeId) return NextResponse.json({ success: false, message: "훈련생을 선택해주세요." }, { status: 400 });
      const trainee = await findTraineeAtSiteInPeriod(BigInt(traineeId), site.id, start, end); // IDOR 방지: 배정 현장+기간 재적 훈련생만
      if (!trainee) return NextResponse.json({ success: false, message: "해당 기간에 이 현장 소속이 아닌 훈련생입니다." }, { status: 400 });
      const ev = await prisma.traineeEvaluation.findFirst({
        where: { traineeId: BigInt(traineeId), writerId: workerId, evalType: "TRAINING", periodStart: { lte: end }, periodEnd: { gte: start } }, // P2: 문서 기간 겹침
        orderBy: { updatedAt: "desc" },
      });
      if (!ev) return NextResponse.json({ success: false, message: "종합평가를 먼저 작성해주세요." }, { status: 400 });
      if (!ev.isConfirmed) return NextResponse.json({ success: false, message: "종합평가를 최종 확정한 후 PDF를 생성할 수 있습니다.\n평가 페이지에서 '최종 확정' 버튼을 눌러주세요.", evalNotConfirmed: true }, { status: 400 });

      payload = traineeFinalEvalPayload({
        traineeName: trainee?.name || "", companyName: site.companyName,
        preStartYmd: assignment.stepStart?.toISOString().slice(0, 10) || start,
        start, end, ev,
        signatures: { worker: sigs.worker, agencyAgent: sigs.agencyAgent },
      });
      fileName = buildDocFileName("TRAINEE_FINAL_EVAL", { traineeName: trainee?.name, companyName: site.companyName, start, end });

    } else if (docType === "ADAPTATION_DAILY_LOG") {
      if (!traineeId) return NextResponse.json({ success: false, message: "훈련생을 선택해주세요." }, { status: 400 });
      const trainee = await findTraineeAtSiteInPeriod(BigInt(traineeId), site.id, start, end); // IDOR 방지: 배정 현장+기간 재적 훈련생만
      if (!trainee) return NextResponse.json({ success: false, message: "해당 기간에 이 현장 소속이 아닌 훈련생입니다." }, { status: 400 });
      const logs = await prisma.traineeLog.findMany({
        where: {
          writerId: workerId, traineeId: BigInt(traineeId),
          trainingType: "ADAPTATION",
          attendance: { siteId: site.id, workDate: { gte: start, lte: end } },
        },
        include: { attendance: true, tasks: true },
        orderBy: { attendance: { workDate: "asc" } },
      });

      // 자동 생성 행에서 제외할 휴무일 = 한국 공휴일 + 현장 커스텀 휴무(근무 미인정)
      const siteHols = await prisma.siteHoliday.findMany({
        where: { assignmentId: assignment.id, countAsWorkday: false },
        select: { date: true },
      });
      const holidays = [...new Set([...getKrHolidayDates(start, end), ...siteHols.map(h => h.date)])];

      payload = adaptationDailyLogPayload({
        traineeName: trainee?.name || "", companyName: site.companyName,
        start, end, logs, docTimes, holidays,
        signatures: { worker: sigs.worker, govAgent: sigs.govAgent },
      });
      fileName = buildDocFileName("ADAPTATION_DAILY_LOG", { traineeName: trainee?.name, companyName: site.companyName, start, end });

    } else if (docType === "ADAPTATION_FINAL_EVAL") {
      if (!traineeId) return NextResponse.json({ success: false, message: "훈련생을 선택해주세요." }, { status: 400 });
      const trainee = await findTraineeAtSiteInPeriod(BigInt(traineeId), site.id, start, end); // IDOR 방지: 배정 현장+기간 재적 훈련생만
      if (!trainee) return NextResponse.json({ success: false, message: "해당 기간에 이 현장 소속이 아닌 훈련생입니다." }, { status: 400 });
      const ev = await prisma.traineeEvaluation.findFirst({
        where: { traineeId: BigInt(traineeId), writerId: workerId, evalType: "ADAPTATION", periodStart: { lte: end }, periodEnd: { gte: start } }, // P2: 문서 기간 겹침
        orderBy: { updatedAt: "desc" },
      });
      if (!ev) return NextResponse.json({ success: false, message: "종합평가를 먼저 작성해주세요." }, { status: 400 });
      if (!ev.isConfirmed) return NextResponse.json({ success: false, message: "종합평가를 최종 확정한 후 PDF를 생성할 수 있습니다.\n평가 페이지에서 '최종 확정' 버튼을 눌러주세요.", evalNotConfirmed: true }, { status: 400 });

      payload = adaptationFinalEvalPayload({
        traineeName: trainee?.name || "", companyName: site.companyName,
        start, end, ev,
        workedDays: await prisma.traineeLog.count({ where: { writerId: workerId, traineeId: BigInt(traineeId), trainingType: "ADAPTATION", attendance: { siteId: site.id, workDate: { gte: start, lte: end } } } }),
        signatures: { worker: sigs.worker, agencyAgent: sigs.agencyAgent },
      });
      fileName = buildDocFileName("ADAPTATION_FINAL_EVAL", { traineeName: trainee?.name, companyName: site.companyName, start, end });

    } else {
      return NextResponse.json({ success: false, message: `지원하지 않는 문서: ${docType}` }, { status: 400 });
    }

    // ── PDF 생성 ──────────────────────────────────────────
    const pdfBuffer = await renderPdfToBuffer({ documentType: docType, payload });

    // ── 이메일 발송 ───────────────────────────────────────
    let emailSent = false;
    let emailError: string | undefined;
    if (sendEmail && toEmail) {
      try {
        await sendEmailWithPdf({
          from: process.env.EMAIL_FROM || "Able-Link <noreply@able-link.co.kr>",
          to: toEmail,
          subject: `[Able-Link] ${DOC_LABELS[docType] || docType} - ${site.companyName} (${start} ~ ${end})`,
          body: `안녕하세요.\n\n${site.companyName} 직무지도 ${DOC_LABELS[docType]||docType}를 첨부합니다.\n\n■ 직무지도원: ${user?.workerName||""}\n■ 기간: ${start} ~ ${end}\n\n감사합니다.\nAble-Link`,
          pdfBuffer,
          fileName,
        });
        emailSent = true;
      } catch (err: any) {
        console.error("[docs/generate] 이메일 발송 실패:", err?.message ?? err);
        emailError = "이메일 발송에 실패했습니다. PDF는 정상 생성되었습니다.";
      }
    }

    return NextResponse.json({
      success: true,
      fileName,
      emailSent,
      pdfBase64: pdfBuffer.toString("base64"),
      message: emailSent ? `${toEmail}로 발송되었습니다.` : (emailError ?? "PDF가 생성되었습니다."),
    });

  } catch (error: any) {
    console.error("[docs/generate]", error);
    // 내부 예외 message(쿼리·경로 등 내부정보 포함 가능)는 클라이언트에 노출하지 않는다(P3 위생).
    //  사용자 안내가 필요한 검증 오류는 위에서 DocPayloadError로 이미 4xx 처리됨.
    return NextResponse.json({ success: false, message: "PDF 생성 오류" }, { status: 500 });
  }
}
