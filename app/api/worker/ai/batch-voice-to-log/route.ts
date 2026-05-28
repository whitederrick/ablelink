// app/api/worker/ai/batch-voice-to-log/route.ts
// 음성 1회 녹음 → 날짜×훈련생 조합별 일지 초안 일괄 생성 (STARTER+)
// STT: Groq Whisper Large V3 Turbo
// LLM: Google Gemini 2.5 Flash Lite

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { checkPlanAccess, startTrialIfNeeded } from "@/lib/planGuard";
import { prisma } from "@/lib/prisma";

function pad2(n: number) { return String(n).padStart(2, "0"); }

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

export async function POST(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) {
      return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    }

    const userId = BigInt(session.userId);
    const planCheck = await checkPlanAccess(userId, "AI_VOICE");

    if (!planCheck.allowed) {
      if (planCheck.reason === "FREE_PLAN") {
        const assignment = await prisma.siteAssignment.findFirst({
          where: { userId, status: "ACTIVE" },
          include: { agency: true },
          orderBy: { startDate: "desc" },
        });
        if (assignment?.agencyId) {
          await startTrialIfNeeded(assignment.agencyId);
          const recheck = await checkPlanAccess(userId, "AI_VOICE");
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

    const formData = await request.formData();
    const audioBlob = formData.get("audio") as Blob | null;
    const dateFrom  = (formData.get("dateFrom")  as string || "").trim();
    const dateTo    = (formData.get("dateTo")    as string || "").trim();
    const workingDatesJson = (formData.get("workingDates") as string || "");
    const traineesJson = (formData.get("trainees") as string || "[]");
    const sentenceCount = Math.min(4, Math.max(2, Number(formData.get("sentenceCount") ?? 2)));

    if (!audioBlob || audioBlob.size === 0) {
      return NextResponse.json({ success: false, message: "음성 파일이 없습니다." }, { status: 400 });
    }
    if (!dateFrom || !dateTo) {
      return NextResponse.json({ success: false, message: "날짜 범위를 선택해주세요." }, { status: 400 });
    }

    let trainees: { id: string; name: string }[] = [];
    try { trainees = JSON.parse(traineesJson); } catch {}
    if (trainees.length === 0) {
      return NextResponse.json({ success: false, message: "훈련생을 1명 이상 선택해주세요." }, { status: 400 });
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
      headers: { Authorization: `Bearer ${groqKey}` },
      body: groqForm,
    });

    if (!groqRes.ok) {
      console.error("[batch-voice-to-log] Groq STT 오류:", groqRes.status, await groqRes.text());
      return NextResponse.json({ success: false, message: "음성 인식에 실패했습니다." }, { status: 500 });
    }

    const transcript = (await groqRes.text()).trim();
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
      return NextResponse.json({ success: true, drafts, transcript });
    }

    const dateList  = dates.join(", ");
    const traineeList = trainees.map(t => t.name).join(", ");

    const prompt = `당신은 장애인 직무지도원의 업무일지 작성을 돕는 전문 어시스턴트입니다.

직무지도원이 아래 기간 동안 훈련생들을 지도한 내용을 한 번에 녹음했습니다.
이 발화를 바탕으로 각 날짜×훈련생 조합별 일지 초안을 작성하세요.

날짜 목록: ${dateList}
훈련생 목록: ${traineeList}
총 조합 수: ${dates.length * trainees.length}개

작성 규칙:
- 각 조합에 대해 ${sentenceCount}문장 일지 작성
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 4000 },
        }),
      }
    );

    if (!geminiRes.ok) {
      console.error("[batch-voice-to-log] Gemini 오류:", geminiRes.status, await geminiRes.text());
      // Gemini 실패 시 transcript 채워 반환
      const drafts = dates.flatMap(date =>
        trainees.map(t => ({ date, traineeId: t.id, traineeName: t.name, content: transcript }))
      );
      return NextResponse.json({ success: true, drafts, transcript });
    }

    const geminiData = await geminiRes.json();
    const rawText: string = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    // JSON 파싱 (마크다운 코드블록 제거)
    const cleaned = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    let aiDrafts: { date: string; traineeName: string; content: string }[] = [];
    try {
      aiDrafts = JSON.parse(cleaned);
    } catch {
      console.error("[batch-voice-to-log] JSON 파싱 실패:", rawText.slice(0, 200));
    }

    // traineeId 매핑 + fallback
    const traineeMap = new Map(trainees.map(t => [t.name, t.id]));
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

    return NextResponse.json({ success: true, drafts, transcript });
  } catch (error: any) {
    console.error("[batch-voice-to-log] 서버 오류:", error);
    return NextResponse.json({ success: false, message: "AI 변환 중 오류가 발생했습니다." }, { status: 500 });
  }
}
