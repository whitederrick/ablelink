// app/api/worker/ai/voice-to-log/route.ts
// 음성 → AI 일지 변환 API (PREMIUM 전용)
// STT: Groq Whisper Large V3 Turbo (가장 저렴 + 빠름, $0.04/시간)
// LLM: Google Gemini 2.0 Flash (저렴 + 한국어 우수)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { checkPlanAccess, startTrialIfNeeded } from "@/lib/planGuard";
import { prisma } from "@/lib/prisma";

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
        return NextResponse.json({
          success: false,
          message: planCheck.message,
          reason: planCheck.reason,
        }, { status: 403 });
      }
    }

    // multipart/form-data로 오디오 파일 수신
    const formData = await request.formData();
    const audioBlob = formData.get("audio") as Blob | null;
    const traineeName = (formData.get("traineeName") as string) || "훈련생";
    const taskScore = Number(formData.get("taskScore") ?? 3);
    const sentenceCount = Math.min(4, Math.max(2, Number(formData.get("sentenceCount") ?? 2)));

    if (!audioBlob || audioBlob.size === 0) {
      return NextResponse.json({ success: false, message: "음성 파일이 없습니다." }, { status: 400 });
    }

    // ── STEP 1: Groq Whisper로 STT ───────────────────────────
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
    // 훈련생 이름과 공통 직무지도 용어만 힌트로 제공
    groqForm.append("prompt", `직무지도원 업무일지. 훈련생 이름: ${traineeName}. 직무지도, 수행, 지도, 훈련, 출퇴근, 휴게, 지각, 조퇴, 결석, 반항, 거부, 협조, 수행률`);

    console.log("[voice-to-log] Groq Whisper STT 시작, 파일 크기:", audioBlob.size, "bytes");

    const groqRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey}` },
      body: groqForm,
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error("[voice-to-log] Groq STT 오류:", groqRes.status, errText);
      return NextResponse.json({ success: false, message: "음성 인식에 실패했습니다." }, { status: 500 });
    }

    const transcript = (await groqRes.text()).trim();
    console.log("[voice-to-log] STT 결과:", transcript);

    if (!transcript) {
      return NextResponse.json({ success: false, message: "음성을 인식할 수 없습니다. 다시 시도해주세요." });
    }

    // ── STEP 2: Gemini로 일지 문장 변환 ──────────────────────
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      // Gemini 없으면 STT 결과 그대로 반환
      console.warn("[voice-to-log] GEMINI_API_KEY 없음 - STT 결과 반환");
      return NextResponse.json({ success: true, content: transcript });
    }

    const scoreLabel = ["매우 못함", "못함", "보통", "잘함", "매우 잘함"][(taskScore || 3) - 1] || "보통";

    const prompt = `당신은 장애인 직무지도원의 업무일지 작성을 돕는 전문 어시스턴트입니다.

아래 발화 내용을 업무일지 문장 정확히 ${sentenceCount}개로 변환하세요.

조건:
- 훈련생: ${traineeName} / 수행 평가: ${scoreLabel}
- 반드시 ${sentenceCount}문장만 출력 (${sentenceCount + 1}문장 이상 금지)
- 문장당 25~35자 내외로 간결하게
- 1인칭 서술, 핵심 내용만
- 설명·인사말·따옴표 없이 일지 내용만 출력
- 음성 인식 오류는 문맥에 맞게 보정

발화:
"${transcript}"

일지:`;

    console.log("[voice-to-log] Gemini 변환 시작");

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 400 },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("[voice-to-log] Gemini 오류:", geminiRes.status, errText);
      // Gemini 실패시 STT 결과 반환 (UX 유지)
      return NextResponse.json({ success: true, content: transcript });
    }

    const geminiData = await geminiRes.json();
    const aiContent =
      geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || transcript;

    console.log("[voice-to-log] 변환 완료:", aiContent.slice(0, 50) + "...");

    return NextResponse.json({ success: true, content: aiContent, transcript });
  } catch (error: any) {
    console.error("[voice-to-log] 서버 오류:", error);
    return NextResponse.json(
      { success: false, message: "AI 변환 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
