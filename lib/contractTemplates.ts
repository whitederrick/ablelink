// lib/contractTemplates.ts
// 근로계약서 양식(템플릿) 레지스트리.
//  - 공통 입력(당사자·기간·근무·임금 등)은 EmploymentContract 표준 필드 그대로 사용.
//  - 양식별 "추가 입력"만 extraFields로 정의 → 그 양식 선택 시 UI가 동적으로 렌더, templateData(JSON)에 저장.
//  - 렌더러(pdfkit)는 templateKey로 분기.
//  - restricted=true 양식은 "위탁기관 전용" — Agency.allowedContractTemplates 에 포함된 기관에서만 노출/사용.
//    (운영자가 양식을 제작·등록한 뒤 해당 기관에 부여하는 구조)

export type TemplateFieldType = "date" | "checkbox" | "text";

export interface TemplateField {
  key: string;
  label: string;
  type: TemplateFieldType;
  hint?: string;
}

// 본문 손글씨 '듣고 인지함' 확인 — 일부 양식(예: 성동07)은 직무지도원이 계약 서명 시
// 가이드 문구를 화면에 띄우고 그대로 따라 손글씨로 작성해야 한다. (서명 이미지와는 별개)
// 캡처 결과는 EmploymentContract.templateData.heardHandwritingUrl 에 저장되고, 렌더러가 본문에 그린다.
export interface AcknowledgementConfig {
  guideText: string;       // 화면에 따라쓰기 가이드로 표시 + 미작성 시 본문 회색 안내로 표시할 문구
}

export interface ContractTemplate {
  key: string;
  label: string;
  sub?: string;            // 선택 화면 보조 설명
  restricted?: boolean;    // true = 위탁기관 전용(부여된 기관만). 미지정/false = 전체 공용.
  extraFields: TemplateField[];
  acknowledgement?: AcknowledgementConfig; // 지정 시 서명 화면에 손글씨 '듣고 인지함' 입력을 요구
}

// ※ 생년월일은 Worker.birthDate(직무지도원 관리/프로필) 단일 출처 사용 — 계약별 입력 제거.
export const CONTRACT_TEMPLATES: ContractTemplate[] = [
  {
    key: "STANDARD",
    label: "표준 근로계약서",
    sub: "고용노동부 표준양식 (전체 공용)",
    extraFields: [],
  },
  {
    key: "SEONGDONG_07",
    label: "성동장애인자립생활센터_근로계약서",
    restricted: true,
    extraFields: [],
    // 제3조⑧ — 직무지도원이 서명 시 "듣고 인지했음"을 따라 손글씨로 직접 작성(렌더러가 본문에 배치)
    acknowledgement: { guideText: "듣고 인지했음" },
  },
  {
    key: "NORTH_06",
    label: "서울시립북부장애인종합복지관_근로계약서",
    restricted: true,
    extraFields: [],
  },
];

export const CONTRACT_TEMPLATE_KEYS = CONTRACT_TEMPLATES.map(t => t.key);
export const DEFAULT_TEMPLATE_KEY = "STANDARD";

// 전체 공용 양식(restricted 아님)
export const PUBLIC_TEMPLATES = CONTRACT_TEMPLATES.filter(t => !t.restricted);
// 위탁기관 전용 양식(운영자 부여 대상)
export const RESTRICTED_TEMPLATES = CONTRACT_TEMPLATES.filter(t => t.restricted);

export function getTemplate(key: string | null | undefined): ContractTemplate {
  return CONTRACT_TEMPLATES.find(t => t.key === key) ?? CONTRACT_TEMPLATES[0];
}
// 해당 양식이 손글씨 '듣고 인지함'을 요구하면 그 설정을, 아니면 null 반환.
export function getAcknowledgement(key: string | null | undefined): AcknowledgementConfig | null {
  return getTemplate(key).acknowledgement ?? null;
}
export function isValidTemplateKey(key: unknown): key is string {
  return typeof key === "string" && CONTRACT_TEMPLATE_KEYS.includes(key);
}

// 특정 위탁기관에 노출 가능한 양식 = 공용 + 부여된 전용 양식
export function visibleTemplates(allowed: string[] | null | undefined): ContractTemplate[] {
  const grant = new Set(allowed ?? []);
  return CONTRACT_TEMPLATES.filter(t => !t.restricted || grant.has(t.key));
}
// 특정 위탁기관이 해당 양식을 사용할 수 있는가 (공용이거나 부여됨)
export function canUseTemplate(key: string, allowed: string[] | null | undefined): boolean {
  const t = CONTRACT_TEMPLATES.find(x => x.key === key);
  if (!t) return false;
  if (!t.restricted) return true;
  return (allowed ?? []).includes(key);
}
