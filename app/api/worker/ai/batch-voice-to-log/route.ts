// app/api/worker/ai/batch-voice-to-log/route.ts
// 음성 1회 녹음 → 날짜×훈련생 조합별 일지 초안 일괄 생성 (STARTER+)
// STT: Groq Whisper Large V3 Turbo
// LLM: Google Gemini 2.5 Flash Lite

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { checkPlanAccess, startTrialIfNeeded } from "@/lib/planGuard";
import { prisma } from "@/lib/prisma";
import { logApiCall } from "@/lib/logApiCall";
import { buildContextLines } from "@/lib/worker/aiContext";
import { getConfigNumber } from "@/lib/systemConfig";


function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  const cur = new Date(from + "T00:00:00");
  const end = new Date(to   + "T00:00:00");
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// 이번 달 AI 일괄 사용 여부 (녹음 전 사전 안내용). 개인당 월 1회.
export async function GET(request: NextRequest) {
  const session = await getWorkerSessionFromReq(request);
  if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
  const workerId = BigInt(session.workerId);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const limit = await getConfigNumber("AI_BATCH_MONTHLY_LIMIT");
  const used = await prisma.apiCallLog.count({
    where: { workerId, service: "GEMINI_BATCH", success: true, createdAt: { gte: monthStart } },
  });
  return NextResponse.json({
    success: true,
    available: used < limit,
    usedThisMonth: used,
    limit,
    remaining: Math.max(0, limit - used),
  });
}

export async function POST(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) {
      return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    }

    const workerId = BigInt(session.workerId);
    const planCheck = await checkPlanAccess(workerId, "AI_VOICE");

    if (!planCheck.allowed) {
      if (planCheck.reason === "FREE_PLAN") {
        const assignment = await prisma.siteAssignment.findFirst({
          where: { workerId, status: "ACTIVE" },
          include: { agency: true },
          orderBy: { startDate: "desc" },
        });
        if (assignment?.agencyId) {
          await startTrialIfNeeded(assignment.agencyId);
          const recheck = await checkPlanAccess(workerId, "AI_VOICE");
          if (!recheck.allowed) {
            return NextResponse.json({ success: false, message: recheck.message }, { status: 403 });
          }
        } else {
          return NextResponse.json({ success: false, message: planCheck.message }, { status: 403 });
        }
      } else {
        return NextResponse.json({ success: false, message: planCheck.message, reason: planCheck.reason }, { status: 403 });
      }
    }

    // ── AI 음성 국외이전 동의 게이트 ──
    // 음성·일지 맥락이 Groq(미국)·Google Gemini(미국)로 전송되므로 최초 사용 전 별도 동의 필수.
    const consentRow = await prisma.worker.findUnique({ where: { id: workerId }, select: { consentAiCrossBorderAt: true } });
    if (!consentRow?.consentAiCrossBorderAt) {
      return NextResponse.json(
        { success: false, needConsent: true, message: "AI 음성 변환을 위한 개인정보 국외이전 동의가 필요합니다." },
        { status: 403 },
      );
    }

    // 개인당 월 N회 (AI 일괄, 운영자 설정값). 비용 방어 — STT/LLM 호출 전에 선차단. 단일 음성 일지는 무제한.
    const monthlyLimit = await getConfigNumber("AI_BATCH_MONTHLY_LIMIT");
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const batchUsedThisMonth = await prisma.apiCallLog.count({
      where: { workerId, service: "GEMINI_BATCH", success: true, createdAt: { gte: monthStart } },
    });
    if (batchUsedThisMonth >= monthlyLimit) {
      return NextResponse.json({
        success: false,
        reason: "MONTHLY_LIMIT",
        message: `AI 일괄 작성은 매월 ${monthlyLimit}회 제공되며, 이번 달 ${monthlyLimit}회를 모두 사용했습니다. 단일 음성 일지는 계속 사용할 수 있어요.`,
      }, { status: 429 });
    }

    const formData = await request.formData();
    const audioBlob = formData.get("audio") as Blob | null;
    const dateFrom  = (formData.get("dateFrom")  as string || "").trim();
    const dateTo    = (formData.get("dateTo")    as string || "").trim();
    const workingDatesJson = (formData.get("workingDates") as string || "");
    const traineesJson = (formData.get("trainees") as string || "[]");
    const sentenceCount = Math.min(3, Math.max(1, Number(formData.get("sentenceCount") ?? 2)));

    if (!audioBlob || audioBlob.size === 0) {
      return NextResponse.json({ success: false, message: "음성 파일이 없습니다." }, { status: 400 });
    }
    const MAX_AUDIO_BYTES = 20 * 1024 * 1024; // 20MB (Groq Whisper 상한 25MB 내, 비용 남용 방어)
    if (audioBlob.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ success: false, message: "음성 파일이 너무 큽니다. (최대 20MB)" }, { status: 413 });
    }
    if (!dateFrom || !dateTo || !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      return NextResponse.json({ success: false, message: "날짜 범위(YYYY-MM-DD)를 선택해주세요." }, { status: 400 });
    }

    let trainees: { id: string; name: string }[] = [];
    try { trainees = JSON.parse(traineesJson); } catch {}
    if (!Array.isArray(trainees) || trainees.length === 0) {
      return NextResponse.json({ success: false, message: "훈련생을 1명 이상 선택해주세요." }, { status: 400 });
    }

    // ★서버 재검증(IDOR·PII): 클라가 보낸 훈련생 목록을 그대로 외부 AI(Groq·Gemini)에 넣지 않는다.
    //   워커가 배정된 현장(들)에 기간([dateFrom,dateTo]) 재적한 훈련생만 허용하고, 이름도 서버 값으로 강제.
    let droppedTrainees: string[] = []; // C7: 소속 검증에서 제외된 훈련생(응답에 명시)
    {
      const workerSites = await prisma.siteAssignment.findMany({
        where: { workerId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } },
        select: { siteId: true },
      });
      const siteIds = [...new Set(workerSites.map(s => s.siteId))];
      const reqIds = trainees
        .map(t => { try { return BigInt(t.id); } catch { return null; } })
        .filter((v): v is bigint => v != null);
      const placements = siteIds.length && reqIds.length
        ? await prisma.traineePlacement.findMany({
            where: {
              siteId: { in: siteIds },
              traineeId: { in: reqIds },
              startDate: { lte: new Date(dateTo + "T23:59:59+09:00") },
              OR: [{ endDate: null }, { endDate: { gte: new Date(dateFrom + "T00:00:00+09:00") } }],
            },
            select: { trainee: { select: { id: true, name: true } } },
          })
        : [];
      const allowed = new Map<string, string>();
      for (const p of placements) allowed.set(String(p.trainee.id), p.trainee.name);
      // C7: 소속 검증에서 제외된 훈련생은 조용히 버리지 않고 응답에 명시(워커가 일부 누락을 인지하도록).
      droppedTrainees = trainees.filter(t => !allowed.has(String(t.id))).map(t => t.name || String(t.id));
      trainees = trainees
        .filter(t => allowed.has(String(t.id)))
        .map(t => ({ id: String(t.id), name: allowed.get(String(t.id))! }));
      if (trainees.length === 0) {
        return NextResponse.json({ success: false, message: "선택한 훈련생이 해당 기간 담당 현장 소속이 아닙니다." }, { status: 403 });
      }
    }

    // 클라이언트가 주말 제외 날짜 목록을 보내면 그대로 사용, 아니면 서버에서 주말 제외 계산
    let dates: string[];
    if (workingDatesJson) {
      try { dates = JSON.parse(workingDatesJson); } catch { dates = []; }
    } else {
      // 서버 측 주말 필터링 (fallback)
      dates = datesBetween(dateFrom, dateTo).filter(d => {
        const dow = new Date(d + "T00:00:00").getDay();
        return dow !== 0 && dow !== 6;
      });
    }
    if (dates.length === 0 || dates.length > 31) {
      return NextResponse.json({ success: false, message: "날짜 범위는 1~31일이어야 합니다." }, { status: 400 });
    }

    // ── STEP 1: Groq Whisper STT ──────────────────────────────
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      return NextResponse.json({ success: false, message: "STT 서비스가 설정되지 않았습니다." }, { status: 500 });
    }

    const audioBuffer = await audioBlob.arrayBuffer();
    const audioFile = new File([audioBuffer], "recording.webm", { type: "audio/webm" });

    const groqForm = new FormData();
    groqForm.append("file", audioFile);
    groqForm.append("model", "whisper-large-v3-turbo");
    groqForm.append("language", "ko");
    groqForm.append("response_format", "text");
    groqForm.append(
      "prompt",
      `직무지도원 업무일지 일괄 녹음. 훈련생: ${trainees.map(t => t.name).join(", ")}. 직무지도, 수행, 지도, 훈련, 출퇴근, 휴게, 지각, 조퇴, 결석, 반항, 거부, 협조, 수행률`
    );

    const groqRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      signal: AbortSignal.timeout(20000), // 벤더 스톨 시 함수 예산 소진 대신 빠르게 실패→기존 폴백

      headers: { Authorization: `Bearer ${groqKey}` },
      body: groqForm,
    });

    if (!groqRes.ok) {
      // 제공자 오류 body는 발화 원문 등 PII를 되돌려줄 수 있어 로그에 남기지 않는다(상태코드만).
      console.error("[batch-voice-to-log] Groq STT 오류:", groqRes.status);
      void logApiCall(workerId, "GROQ_STT", false);
      return NextResponse.json({ success: false, message: "음성 인식에 실패했습니다." }, { status: 500 });
    }

    const transcript = (await groqRes.text()).trim();
    void logApiCall(workerId, "GROQ_STT", true);
    if (!transcript) {
      return NextResponse.json({ success: false, message: "음성을 인식할 수 없습니다. 다시 시도해주세요." });
    }

    // ── STEP 2: Gemini 일괄 일지 생성 ────────────────────────
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      // Gemini 없으면 transcript를 모든 조합에 그대로 채워 반환
      const drafts = dates.flatMap(date =>
        trainees.map(t => ({ date, traineeId: t.id, traineeName: t.name, content: transcript }))
      );
      return NextResponse.json({ success: true, drafts, transcript, droppedTrainees });
    }

    const dateList  = dates.join(", ");
    const traineeList = trainees.map(t => t.name).join(", ");

    // 현장·수행과제·계약(근무조건) 맥락 — AI가 실제 현장/과제/계약 기반으로 구체적으로 쓰게 해 '밋밋함' 방지
    const ctxAssignment = await prisma.siteAssignment.findFirst({
      where: { workerId, status: { in: ["ACTIVE", "CONFIRMED", "ASSIGNED"] } },
      orderBy: { startDate: "desc" },
      select: {
        startDate: true, endDate: true, workType: true, customWorkStart: true, customWorkEnd: true,
        site: { select: { companyName: true, neededActivities: true } },
      },
    });
    const recentTasks = await prisma.traineeLogTask.findMany({
      where: { log: { attendance: { workerId } } },
      select: { taskName: true },
      distinct: ["taskName"],
      orderBy: { id: "desc" },
      take: 15,
    });
    const ctxLines = buildContextLines(ctxAssignment, recentTasks);
    const contextBlock = ctxLines.length
      ? `\n현장·과제·계약 맥락(반드시 반영해 구체적으로 작성):\n${ctxLines.join("\n")}\n`
      : "";

    const prompt = `당신은 장애인 직무지도원의 업무일지 작성을 돕는 전문 어시스턴트입니다.

직무지도원이 아래 기간 동안 훈련생들을 지도한 내용을 한 번에 녹음했습니다.
이 발화를 바탕으로 각 날짜×훈련생 조합별 일지 초안을 작성하세요.

날짜 목록: ${dateList}
훈련생 목록: ${traineeList}
총 조합 수: ${dates.length * trainees.length}개
${contextBlock}
작성 규칙:
- 각 조합에 대해 ${sentenceCount}문장 일지 작성
- 위 '현장 주요 활동'과 '자주 수행한 과제'를 반영해 구체적이고 현실적으로 작성(막연하고 밋밋한 표현 지양)
- 문장당 25~35자 내외로 간결하게
- 1인칭 서술(예: "○○에게 ~~~을 지도했다.")
- 발화에서 특정 날짜 또는 훈련생이 명시되면 해당 조합에 반영
- 명시가 없는 부분은 전체 내용을 기반으로 합리적으로 분배
- 음성 인식 오류(이상한 단어)는 문맥에 맞게 보정
- 반드시 아래 JSON 배열 형식만 출력 (다른 설명 금지)

출력 형식 (JSON 배열):
[
  {"date":"YYYY-MM-DD","traineeName":"이름","content":"일지 내용 2문장"},
  ...
]

발화:
"${transcript}"`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        signal: AbortSignal.timeout(20000), // 벤더 스톨 시 빠르게 실패→기존 전사(transcript) 폴백
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 4000 },
        }),
      }
    );

    if (!geminiRes.ok) {
      // 제공자 오류 body는 프롬프트(발화·훈련생명 포함) 일부를 되돌려줄 수 있어 로그에 남기지 않는다(상태코드만).
      console.error("[batch-voice-to-log] Gemini 오류:", geminiRes.status);
      void logApiCall(workerId, "GEMINI_BATCH", false);
      const drafts = dates.flatMap(date =>
        trainees.map(t => ({ date, traineeId: t.id, traineeName: t.name, content: transcript }))
      );
      return NextResponse.json({ success: true, drafts, transcript, droppedTrainees });
    }

    const geminiData = await geminiRes.json();
    const rawText: string = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    // JSON 파싱 (마크다운 코드블록 제거)
    const cleaned = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    let aiDrafts: { date: string; traineeName: string; content: string }[] = [];
    try {
      aiDrafts = JSON.parse(cleaned);
    } catch {
      // rawText는 생성된 일지 내용(훈련생명·지도내용=PII)이라 로그에 남기지 않는다. 길이만 기록.
      console.error("[batch-voice-to-log] JSON 파싱 실패, 응답 길이:", rawText.length);
    }

    const drafts = dates.flatMap(date =>
      trainees.map(t => {
        const ai = aiDrafts.find(d => d.date === date && d.traineeName === t.name);
        return {
          date,
          traineeId: t.id,
          traineeName: t.name,
          content: ai?.content ?? transcript,
        };
      })
    );

    void logApiCall(workerId, "GEMINI_BATCH", true);
    return NextResponse.json({ success: true, drafts, transcript, droppedTrainees });
  } catch (error: any) {
    console.error("[batch-voice-to-log] 서버 오류:", error);
    return NextResponse.json({ success: false, message: "AI 변환 중 오류가 발생했습니다." }, { status: 500 });
  }
}
