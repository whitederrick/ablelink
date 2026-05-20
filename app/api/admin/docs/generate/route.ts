// app/api/admin/docs/generate/route.ts
// 관리자가 직무지도원 문서를 PDF로 생성하고 이메일 발송
// POST { coachUserId, docType, periodStart, periodEnd, traineeId?, toEmail }

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminScope";
import { prisma } from "@/lib/prisma";
import {
  generatePdf, sendEmailWithPdf, DOC_LABELS,
  buildAttendanceSheetData, buildTrainingDailyLogData,
  buildTraineeFinalEvalData, buildAdaptationDailyLogData,
  buildAdaptationFinalEvalData,
  type DocType, type SignatureSet,
} from "@/lib/pdfGenerator";

function fmtHHMM(d: Date) {
  const kst = new Date(d.getTime() + 9*60*60*1000);
  return `${String(kst.getUTCHours()).padStart(2,"0")}:${String(kst.getUTCMinutes()).padStart(2,"0")}`;
}
function fmtPeriod(s: string, e: string) { return `${s.replace(/-/g,".")} ~ ${e.replace(/-/g,".")}`; }
function scoreLabel(n?: number|null) { return n ? ({1:"매우못함",2:"못함",3:"보통",4:"잘함",5:"매우잘함"} as any)[n]||String(n) : ""; }
function defaultScores() { return Array.from({length:5},()=>({initial:"",final:""})); }

export async function POST(request: NextRequest) {
  try {
    const scope = await requireAdminSession(request);
    const body = await request.json();
    const { coachUserId, docType, periodStart, periodEnd, traineeId, toEmail } = body;

    if (!coachUserId || !docType || !periodStart || !periodEnd)
      return NextResponse.json({ success:false, message:"필수 파라미터 누락" }, { status:400 });

    const userId = BigInt(coachUserId);
    const startStr = periodStart, endStr = periodEnd;

    // 직무지도원 정보
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { userName:true, phoneNumber:true, signatureUrl:true, loginId:true },
    });

    // 현장 배정
    const assignment = await prisma.siteAssignment.findFirst({
      where: { userId, status: { in: ["ASSIGNED","CONFIRMED","ACTIVE"] } },
      include: {
        site: true,
        assignedByAdmin: { select: { signatureUrl:true, displayName:true } },
      },
      orderBy: { assignedAt: "desc" },
    });
    if (!assignment?.site) return NextResponse.json({ success:false, message:"배정된 현장 없음" }, { status:404 });

    // govAgent: assignedByAdmin 우선, 없으면 현재 로그인 관리자
    let adminForSign: any = assignment.assignedByAdmin;
    if (!adminForSign) {
      adminForSign = await prisma.adminUser.findUnique({
        where: { id: scope.userId },
        select: { signatureUrl:true, displayName:true } as any,
      });
    }
    if (!adminForSign && assignment.agencyId) {
      adminForSign = await prisma.adminUser.findFirst({
        where: { agencyId: assignment.agencyId, isActive: true },
        select: { signatureUrl:true, displayName:true } as any,
        orderBy: { id: "asc" },
      });
    }

    const signatures: SignatureSet = {
      coachImageUrl:       user?.signatureUrl        || null,
      coachName:           user?.userName            || "",
      govAgentImageUrl:    adminForSign?.signatureUrl || null,
      govAgentName:        adminForSign?.displayName  || "",
      agencyAgentImageUrl: adminForSign?.signatureUrl || null,
      agencyAgentName:     adminForSign?.displayName  || "",
    };

    const site = assignment.site;
    const docLabel = DOC_LABELS[docType as DocType] || docType;
    let pdfData: Record<string,any>;
    let fileName: string;

    if (docType === "attendance-sheet") {
      const attendances = await prisma.dailyAttendance.findMany({
        where: { userId, workDate:{ gte:startStr, lte:endStr } },
        include: { logs:{ select:{ time1on1:true, timeGroup:true, extTime1on1:true, extTimeGroup:true } } },
        orderBy: { workDate:"asc" },
      });
      pdfData = buildAttendanceSheetData({
        coachName: user?.userName||"", coachPhone: user?.phoneNumber||user?.loginId||"",
        companyName: site.companyName, periodStart:startStr, periodEnd:endStr,
        attendances: attendances.map(a=>({
          workDate:a.workDate,
          startTime: a.startTime?fmtHHMM(a.startTime):null,
          endTime:   a.endTime  ?fmtHHMM(a.endTime)  :null,
          time1on1:    a.logs.reduce((s,l)=>s+Number(l.time1on1),0),
          timeGroup:   a.logs.reduce((s,l)=>s+Number(l.timeGroup),0),
          extTime1on1: a.logs.reduce((s,l)=>s+Number(l.extTime1on1),0),
          extTimeGroup:a.logs.reduce((s,l)=>s+Number(l.extTimeGroup),0),
        })),
        signatures,
      });
      fileName = `출근부_${site.companyName}_${startStr}_${endStr}.pdf`;

    } else if (docType === "training-daily-log") {
      const tid = traineeId ? BigInt(traineeId) : null;
      const trainee = tid ? await prisma.trainee.findUnique({ where:{id:tid}, select:{name:true} }) : null;
      const logs = tid ? await prisma.traineeLog.findMany({
        where:{ writerId:userId, traineeId:tid, trainingType:{in:["PRE","FIELD"]}, attendance:{workDate:{gte:startStr,lte:endStr}} },
        include:{ attendance:true, tasks:true }, orderBy:{ attendance:{workDate:"asc"} },
      }) : [];
      pdfData = buildTrainingDailyLogData({
        traineeName: trainee?.name||"", companyName: site.companyName,
        preTrainingPeriod:   fmtPeriod(assignment.stepStart?.toISOString().slice(0,10)||startStr, startStr),
        fieldTrainingPeriod: fmtPeriod(startStr, endStr),
        entries: logs.map(l=>({ trainingType:l.trainingType as "PRE"|"FIELD", date:l.attendance.workDate,
          attendance:l.evaluation||"출석", hours:`${Number(l.totalRecognizedTime)}H`, guidance:"Y",
          task:l.tasks[0]?.taskName||"", performanceLabel:scoreLabel(l.tasks[0]?.performanceScore),
          performanceTime:"", coaching:l.content||"" })),
        signatures,
      });
      fileName = `훈련일지_${trainee?.name||"훈련생"}_${startStr}_${endStr}.pdf`;

    } else if (docType === "trainee-final-eval") {
      const tid = traineeId ? BigInt(traineeId) : null;
      const trainee = tid ? await prisma.trainee.findUnique({ where:{id:tid}, select:{name:true} }) : null;
      pdfData = buildTraineeFinalEvalData({
        traineeName: trainee?.name||"", companyName: site.companyName,
        prePeriod: fmtPeriod(assignment.stepStart?.toISOString().slice(0,10)||startStr, startStr),
        fieldPeriod: fmtPeriod(startStr, endStr),
        scores:{ WORK_ATTITUDE:defaultScores(), INTERPERSONAL:defaultScores(), WORK_STYLE:defaultScores(), WORK_PERFORMANCE:defaultScores() },
        comments:{}, signatures,
      });
      fileName = `훈련생평가_${trainee?.name||"훈련생"}_${startStr}_${endStr}.pdf`;

    } else if (docType === "adaptation-daily-log") {
      const tid = traineeId ? BigInt(traineeId) : null;
      const trainee = tid ? await prisma.trainee.findUnique({ where:{id:tid}, select:{name:true} }) : null;
      const logs = tid ? await prisma.traineeLog.findMany({
        where:{ writerId:userId, traineeId:tid, trainingType:"ADAPTATION", attendance:{workDate:{gte:startStr,lte:endStr}} },
        include:{ attendance:true, tasks:true }, orderBy:{ attendance:{workDate:"asc"} },
      }) : [];
      pdfData = buildAdaptationDailyLogData({
        traineeName: trainee?.name||"", companyName: site.companyName,
        periodStart:startStr, periodEnd:endStr,
        entries: logs.map(l=>({ date:l.attendance.workDate, attendance:l.evaluation||"출석",
          workTime:"", guidance:"Y", task:l.tasks[0]?.taskName||"",
          performanceLabel:scoreLabel(l.tasks[0]?.performanceScore), performanceTime:"", coaching:l.content||"" })),
        signatures,
      });
      fileName = `적응지도일지_${trainee?.name||"훈련생"}_${startStr}_${endStr}.pdf`;

    } else if (docType === "adaptation-final-eval") {
      const tid = traineeId ? BigInt(traineeId) : null;
      const trainee = tid ? await prisma.trainee.findUnique({ where:{id:tid}, select:{name:true} }) : null;
      pdfData = buildAdaptationFinalEvalData({
        traineeName: trainee?.name||"", companyName: site.companyName,
        periodStart:startStr, periodEnd:endStr,
        scores:{ WORK_ATTITUDE:defaultScores(), INTERPERSONAL:defaultScores(), WORK_STYLE:defaultScores(), WORK_PERFORMANCE:defaultScores() },
        comments:{}, signatures,
      });
      fileName = `적응지도평가_${trainee?.name||"훈련생"}_${startStr}_${endStr}.pdf`;

    } else {
      return NextResponse.json({ success:false, message:"지원하지 않는 문서" }, { status:400 });
    }

    const pdfBuffer = await generatePdf(docType as DocType, pdfData);

    // 이메일 발송
    let emailSent = false;
    if (toEmail) {
      await sendEmailWithPdf({
        from: process.env.EMAIL_FROM || "AbleLink <noreply@able-link.co.kr>",
        to: toEmail,
        subject: `[AbleLink] ${docLabel} - ${site.companyName} (${startStr} ~ ${endStr})`,
        body: `안녕하세요.\n\n${site.companyName} 직무지도 ${docLabel}를 첨부합니다.\n\n■ 직무지도원: ${user?.userName||""}\n■ 기간: ${startStr} ~ ${endStr}\n\n감사합니다.\nAbleLink`,
        pdfBuffer, fileName,
      });
      emailSent = true;
    }

    return NextResponse.json({
      success: true,
      fileName, emailSent,
      pdfBase64: pdfBuffer.toString("base64"),
      message: emailSent ? `${toEmail}으로 발송되었습니다.` : "PDF가 생성되었습니다.",
    });

  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/docs/generate]", e);
    return NextResponse.json({ success:false, message: e.message||"오류" }, { status:500 });
  }
}
