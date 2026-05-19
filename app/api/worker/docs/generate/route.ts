// app/api/worker/docs/generate/route.ts
// PDF 생성 + AWS SES 자동 이메일 발송 (PREMIUM 전용)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { checkPlanAccess } from "@/lib/planGuard";
import { prisma } from "@/lib/prisma";
import {
  generatePdf,
  buildAttendanceSheetData,
  sendEmailWithPdf,
  DOC_LABELS,
  type DocType,
} from "@/lib/pdfGenerator";

export async function POST(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) {
      return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    }

    const userId = BigInt(session.userId);

    // 🔐 PREMIUM 체크
    const planCheck = await checkPlanAccess(userId, "PDF_GENERATE");
    if (!planCheck.allowed) {
      return NextResponse.json({ success: false, message: planCheck.message }, { status: 403 });
    }

    const body = await request.json();
    const { docType, periodStart, periodEnd, sendEmail, toEmail } = body;

    if (!docType) {
      return NextResponse.json({ success: false, message: "문서 종류를 선택해주세요." }, { status: 400 });
    }

    // 사용자 + 배정 + 서명 조회
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        userName: true,
        phoneNumber: true,
        signatureUrl: true,
        loginId: true, // 전화번호가 loginId
      },
    });

    const assignment = await prisma.siteAssignment.findFirst({
      where: { userId, status: "ACTIVE" },
      include: {
        site: {
          include: {
            agencyManager: { select: { name: true, email: true } },
          },
        },
      },
      orderBy: { startDate: "desc" },
    });

    if (!assignment?.site) {
      return NextResponse.json({ success: false, message: "배정된 현장이 없습니다." }, { status: 400 });
    }

    const site = assignment.site;
    const start = periodStart || assignment.startDate?.toISOString().slice(0, 10) || "";
    const end = periodEnd || new Date().toISOString().slice(0, 10);

    let pdfData: Record<string, any> = {};
    let fileName = "";
    const docLabel = DOC_LABELS[docType as DocType] || docType;

    if (docType === "attendance-sheet") {
      const attendances = await prisma.dailyAttendance.findMany({
        where: {
          userId,
          workDate: { gte: start, lte: end },
        },
        include: {
          logs: {
            select: {
              time1on1: true, timeGroup: true,
              extTime1on1: true, extTimeGroup: true,
            },
          },
        },
        orderBy: { workDate: "asc" },
      });

      pdfData = buildAttendanceSheetData({
        coachName: user?.userName || "",
        coachPhone: user?.phoneNumber || "",
        companyName: site.companyName,
        periodStart: start,
        periodEnd: end,
        attendances: attendances.map(a => ({
          workDate: a.workDate,
          startTime: a.startTime ? formatHHMM(a.startTime) : null,
          endTime: a.endTime ? formatHHMM(a.endTime) : null,
          time1on1: a.logs.reduce((s, l) => s + Number(l.time1on1), 0),
          timeGroup: a.logs.reduce((s, l) => s + Number(l.timeGroup), 0),
          extTime1on1: a.logs.reduce((s, l) => s + Number(l.extTime1on1), 0),
          extTimeGroup: a.logs.reduce((s, l) => s + Number(l.extTimeGroup), 0),
        })),
        signatureUrl: user?.signatureUrl,
      });

      fileName = `출근부_${site.companyName}_${start}_${end}.pdf`;
    } else {
      return NextResponse.json(
        { success: false, message: `지원하지 않는 문서 종류입니다: ${docType}` },
        { status: 400 }
      );
    }

    // PDF 생성
    console.log(`[docs/generate] ${docType} PDF 생성 시작`);
    const pdfBuffer = await generatePdf(docType as DocType, pdfData);
    console.log(`[docs/generate] PDF 생성 완료 ${pdfBuffer.length} bytes`);

    // 이메일 자동 발송
    let emailSent = false;
    if (sendEmail && toEmail) {
      const managerName = site.agencyManager?.name || "담당자";

      // 발신자: noreply@able-link.co.kr (SES 인증 도메인)
      // Reply-To: 직무지도원이 등록한 이메일 (있으면)
      await sendEmailWithPdf({
        from: process.env.EMAIL_FROM || "AbleLink <noreply@able-link.co.kr>",
        to: toEmail,
        subject: `[AbleLink] ${docLabel} 제출 - ${site.companyName} (${start} ~ ${end})`,
        body:
          `안녕하세요, ${managerName}님.\n\n` +
          `${site.companyName} 직무지도 ${docLabel}를 첨부하여 보내드립니다.\n\n` +
          `■ 직무지도원: ${user?.userName || ""}\n` +
          `■ 기간: ${start} ~ ${end}\n\n` +
          `※ 첨부파일을 확인해주시기 바랍니다.\n\n` +
          `감사합니다.\nAbleLink`,
        pdfBuffer,
        fileName,
      });

      emailSent = true;
      console.log(`[docs/generate] 이메일 발송 완료: ${toEmail}`);
    }

    return NextResponse.json({
      success: true,
      fileName,
      pdfBase64: pdfBuffer.toString("base64"),
      emailSent,
      message: emailSent
        ? `${toEmail}로 발송되었습니다.`
        : "PDF가 생성되었습니다.",
    });
  } catch (error: any) {
    console.error("[docs/generate]", error);
    return NextResponse.json(
      { success: false, message: error.message || "PDF 생성 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

function formatHHMM(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
