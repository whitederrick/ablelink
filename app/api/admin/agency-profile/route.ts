// app/api/admin/agency-profile/route.ts
// 매니저 소속 위탁기관 기본 정보 (계약서 사업주 자동채움 등). GET 조회 + PATCH 편집(매니저 셀프).

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { isValidBRN, formatBRN } from "@/lib/validateBRN";
import { isValidTemplateKey, canUseTemplate } from "@/lib/contractTemplates";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type GovContact = { name: string; email: string };

// DB의 govContacts(Json) → 정규화된 배열. 없으면 단일 컬럼으로 폴백(하위호환).
function normalizeGovContacts(raw: any, legacyName: any, legacyEmail: any): GovContact[] {
  const list: GovContact[] = [];
  if (Array.isArray(raw)) {
    for (const it of raw) {
      const email = typeof it?.email === "string" ? it.email.trim() : "";
      if (!email) continue;
      list.push({ name: typeof it?.name === "string" ? it.name.trim() : "", email });
    }
  }
  if (list.length === 0 && typeof legacyEmail === "string" && legacyEmail.trim()) {
    list.push({ name: typeof legacyName === "string" ? legacyName.trim() : "", email: legacyEmail.trim() });
  }
  return list;
}

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const a: any = await prisma.agency.findUnique({
      where: { id: scope.agencyId },
      select: { name: true, phoneNumber: true, address: true, businessNumber: true, representativeName: true, representativeSignatureUrl: true, govContactEmail: true, govContactName: true, govContacts: true, payrollAutoDay: true, lateThresholdMin: true, defaultContractTemplate: true, allowedContractTemplates: true },
    });
    if (!a) return NextResponse.json({ success: false, message: "위탁기관를 찾을 수 없습니다." }, { status: 404 });
    const govContacts = normalizeGovContacts(a.govContacts, a.govContactName, a.govContactEmail);
    return NextResponse.json({
      success: true,
      data: {
        name: a.name,
        phoneNumber: a.phoneNumber,
        address: a.address,
        businessNumber: a.businessNumber,
        representativeName: a.representativeName,
        representativeSignatureUrl: a.representativeSignatureUrl,
        govContacts,
        // 하위호환: 첫 담당자
        govContactEmail: govContacts[0]?.email ?? a.govContactEmail,
        govContactName: govContacts[0]?.name ?? a.govContactName,
        payrollAutoDay: a.payrollAutoDay ?? null,
        lateThresholdMin: a.lateThresholdMin ?? 30,
        defaultContractTemplate: a.defaultContractTemplate ?? null,
        allowedContractTemplates: Array.isArray(a.allowedContractTemplates) ? a.allowedContractTemplates : [],
      },
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[agency-profile GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

// PATCH: 사업주 정보 편집(계약서 자동입력 소스). 이름(name)은 unique 충돌 위험 + 운영자 관리 영역이라 변경 불가.
export async function PATCH(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const body = await req.json().catch(() => ({}));
    const { phoneNumber, address, businessNumber, representativeName, representativeSignatureUrl, govContactEmail, govContactName, govContacts, payrollAutoDay, lateThresholdMin, defaultContractTemplate } = body;

    const str = (v: any): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

    const data: any = {};
    if (payrollAutoDay !== undefined) {
      const n = payrollAutoDay === null || payrollAutoDay === "" ? null : Number(payrollAutoDay);
      // 1~31. 31(또는 그 달에 없는 날)은 그 달 말일로 보정되어 동작(말일 대응).
      if (n !== null && (!Number.isInteger(n) || n < 1 || n > 31)) {
        return NextResponse.json({ success: false, message: "급여 자동 생성일은 1~31 사이여야 합니다. (말일에 맞추려면 31 입력)" }, { status: 400 });
      }
      data.payrollAutoDay = n;
    }
    if (lateThresholdMin !== undefined) {
      const n = Number(lateThresholdMin);
      // 지각 기준(분). 1~180 범위(기본 30). 위탁기관 기본값.
      if (!Number.isInteger(n) || n < 1 || n > 180) {
        return NextResponse.json({ success: false, message: "지각 기준은 1~180분 사이여야 합니다." }, { status: 400 });
      }
      data.lateThresholdMin = n;
    }
    if (defaultContractTemplate !== undefined) {
      if (defaultContractTemplate == null || defaultContractTemplate === "") data.defaultContractTemplate = null;
      else if (!isValidTemplateKey(defaultContractTemplate)) return NextResponse.json({ success: false, message: "유효하지 않은 계약서 양식입니다." }, { status: 400 });
      else {
        // 전용 양식은 운영자가 본 기관에 부여한 경우에만 기본 양식으로 설정 가능
        const ag = await prisma.agency.findUnique({ where: { id: scope.agencyId }, select: { allowedContractTemplates: true } });
        if (!canUseTemplate(defaultContractTemplate, ag?.allowedContractTemplates ?? [])) {
          return NextResponse.json({ success: false, message: "본 기관에 부여되지 않은 전용 양식입니다. 운영자에게 양식 등록을 요청하세요." }, { status: 403 });
        }
        data.defaultContractTemplate = defaultContractTemplate;
      }
    }
    if (phoneNumber !== undefined)        data.phoneNumber = str(phoneNumber);
    if (address !== undefined)            data.address = str(address);
    if (representativeName !== undefined)  data.representativeName = str(representativeName);
    // 복수 공단 담당자 — 우선 적용. 단일 컬럼은 첫 담당자로 동기화(하위호환).
    if (govContacts !== undefined) {
      if (!Array.isArray(govContacts)) {
        return NextResponse.json({ success: false, message: "공단 담당자 형식이 올바르지 않습니다." }, { status: 400 });
      }
      const cleaned: GovContact[] = [];
      const seen = new Set<string>();
      for (const it of govContacts) {
        const email = str(it?.email);
        const nm = str(it?.name);
        if (!email && !nm) continue; // 빈 행은 무시
        if (!email) {
          return NextResponse.json({ success: false, message: "담당자 이메일을 입력해주세요." }, { status: 400 });
        }
        if (!EMAIL_RE.test(email)) {
          return NextResponse.json({ success: false, message: `유효하지 않은 이메일 형식입니다: ${email}` }, { status: 400 });
        }
        const key = email.toLowerCase();
        if (seen.has(key)) continue; // 중복 이메일 제거
        seen.add(key);
        cleaned.push({ name: nm ?? "", email });
      }
      if (cleaned.length > 10) {
        return NextResponse.json({ success: false, message: "공단 담당자는 최대 10명까지 등록할 수 있습니다." }, { status: 400 });
      }
      data.govContacts = cleaned;
      data.govContactName = cleaned[0]?.name ?? null;
      data.govContactEmail = cleaned[0]?.email ?? null;
    } else {
      if (govContactName !== undefined)      data.govContactName = str(govContactName);
      if (govContactEmail !== undefined) {
        const em = str(govContactEmail);
        if (em && !EMAIL_RE.test(em)) {
          return NextResponse.json({ success: false, message: "유효하지 않은 이메일 형식입니다." }, { status: 400 });
        }
        data.govContactEmail = em;
      }
    }
    if (representativeSignatureUrl !== undefined) {
      // data URI(PNG) 또는 null. 과대 페이로드 방지(약 1MB 상한).
      const sig = typeof representativeSignatureUrl === "string" && representativeSignatureUrl.startsWith("data:image") ? representativeSignatureUrl : null;
      if (sig && sig.length > 1_500_000) {
        return NextResponse.json({ success: false, message: "서명 이미지가 너무 큽니다." }, { status: 400 });
      }
      data.representativeSignatureUrl = sig;
    }
    if (businessNumber !== undefined) {
      const bn = str(businessNumber);
      // 사업자등록번호 형식 + 국세청 체크섬 검증
      if (bn && !isValidBRN(bn)) {
        return NextResponse.json({ success: false, message: "유효하지 않은 사업자등록번호입니다. 10자리를 확인해주세요. (예: 123-45-67890)" }, { status: 400 });
      }
      data.businessNumber = bn ? formatBRN(bn) : null;
    }

    try {
      await prisma.agency.update({ where: { id: scope.agencyId }, data });
    } catch (e: any) {
      if (e?.code === "P2002") {
        return NextResponse.json({ success: false, message: "이미 등록된 사업자등록번호입니다." }, { status: 409 });
      }
      throw e;
    }

    return NextResponse.json({ success: true, message: "사업주 정보가 저장되었습니다." });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[agency-profile PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
