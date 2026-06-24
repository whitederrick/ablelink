// app/api/admin/contracts/preview/route.ts
// 계약서 양식 미리보기 — 견본(샘플) 데이터로 선택한 양식(templateKey)의 PDF를 렌더.
//  · 실제 계약을 생성/저장하지 않음. 양식 레이아웃 확인 전용.
//  · 사업주(갑) 정보는 위탁기관 프로필을 자동 반영해 실제와 비슷하게 보여줌.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { renderContractPdf } from "@/lib/contractPdf";
import { isValidTemplateKey, DEFAULT_TEMPLATE_KEY, canUseTemplate } from "@/lib/contractTemplates";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const sp = new URL(req.url).searchParams;

    const raw = sp.get("templateKey");
    let templateKey = isValidTemplateKey(raw) ? raw : DEFAULT_TEMPLATE_KEY;

    // 양식별 추가 입력(예: 성동 '듣고 인지함')은 쿼리로 받아 견본에 반영(선택).
    let templateData: Record<string, any> = {};
    const dataRaw = sp.get("data");
    if (dataRaw) {
      try {
        const parsed = JSON.parse(dataRaw);
        if (parsed && typeof parsed === "object") templateData = parsed;
      } catch { /* 무시 — 견본 기본값 사용 */ }
    }

    // 사업주(갑) 정보 자동 반영(없으면 견본 텍스트) + 전용 양식 부여 여부
    const agency: any = await prisma.agency.findUnique({
      where: { id: scope.agencyId },
      select: { name: true, phoneNumber: true, address: true, allowedContractTemplates: true } as any,
    });
    // 본 기관에 부여되지 않은 전용 양식은 미리보기 불가 → 표준으로 대체
    if (!canUseTemplate(templateKey, agency?.allowedContractTemplates ?? [])) templateKey = DEFAULT_TEMPLATE_KEY;

    // 견본 계약 객체 — buildContractPdfPayload가 기대하는 형태로 구성(저장 안 함).
    const sample = {
      employerBizName: agency?.name || "○○위탁기관",
      employerPhone: agency?.phoneNumber || "02-000-0000",
      employerAddress: agency?.address || "서울특별시 ○○구 ○○로 00",
      employerRepName: "○ ○ ○",
      agency: { name: agency?.name || "", phoneNumber: agency?.phoneNumber || "", address: agency?.address || "" },
      user: { workerName: "홍길동", phoneNumber: "010-1234-5678", birthDate: "1990-01-01" },
      workerAddress: "서울특별시 ○○구 ○○로 00",
      contractStart: new Date(Date.UTC(2026, 0, 2)),
      contractEnd: new Date(Date.UTC(2026, 11, 31)),
      workLocation: "○○사업장",
      jobDescription: "중증장애인 직무지도 및 적응지원",
      workStartTime: "09:00",
      workEndTime: "13:00",
      breakStartTime: "11:00",
      breakEndTime: "11:30",
      workDaysPerWeek: "5",
      weeklyHoliday: "일",
      wageType: "HOURLY",
      wageAmount: "10030",
      bonusExists: false,
      bonusAmount: null,
      extraPayExists: false,
      extraPayDesc: null,
      overtimeRate: "50",
      wagePayday: "25",
      wagePayMethod: "ACCOUNT",
      specialClauses: [
        { title: "비밀유지", body: "근로자는 업무 수행 중 알게 된 훈련생의 개인정보 및 사업체의 비밀을 외부에 누설하지 아니한다. (견본 특약)" },
      ],
      templateKey,
      templateData,
      workerSignatureUrl: null,
      adminSignatureUrl: null,
      workerSignedAt: null,
      adminSignedAt: null,
      createdAt: new Date(),
    };

    const buf = await renderContractPdf(sample);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="contract_preview_${templateKey}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/contracts/preview GET]", e);
    return NextResponse.json({ success: false, message: "미리보기 생성 오류" }, { status: 500 });
  }
}
