// lib/contractTemplates.ts
// 근로계약서 양식(템플릿) 레지스트리.
//  - 공통 입력(당사자·기간·근무·임금 등)은 EmploymentContract 표준 필드 그대로 사용.
//  - 양식별 "추가 입력"만 extraFields로 정의 → 그 양식 선택 시 UI가 동적으로 렌더, templateData(JSON)에 저장.
//  - 렌더러(pdfkit)는 templateKey로 분기(2·3단계에서 구현). 1단계는 선택·저장 뼈대만.

export type TemplateFieldType = "date" | "checkbox" | "text";

export interface TemplateField {
  key: string;
  label: string;
  type: TemplateFieldType;
  hint?: string;
}

export interface ContractTemplate {
  key: string;
  label: string;
  sub?: string;          // 선택 화면 보조 설명
  extraFields: TemplateField[];
}

// ※ 생년월일은 Worker.birthDate(직무지도원 관리/프로필) 단일 출처 사용 — 계약별 입력 제거.
export const CONTRACT_TEMPLATES: ContractTemplate[] = [
  {
    key: "STANDARD",
    label: "표준 근로계약서",
    sub: "고용노동부 표준양식",
    extraFields: [],
  },
  {
    key: "SEONGDONG_07",
    label: "성동장애인자립생활센터 양식",
    sub: "기관 지정 양식(디지털)",
    extraFields: [
      { key: "heardAndAcknowledged", label: "제3조⑧ ‘듣고 인지함’ 확인", type: "checkbox", hint: "직무지도원이 계약 내용을 듣고 인지하였음" },
    ],
  },
  {
    key: "NORTH_06",
    label: "서울시립북부장애인종합복지관 양식",
    sub: "기관 지정 양식(스캔)",
    extraFields: [],
  },
];

export const CONTRACT_TEMPLATE_KEYS = CONTRACT_TEMPLATES.map(t => t.key);
export const DEFAULT_TEMPLATE_KEY = "STANDARD";

export function getTemplate(key: string | null | undefined): ContractTemplate {
  return CONTRACT_TEMPLATES.find(t => t.key === key) ?? CONTRACT_TEMPLATES[0];
}
export function isValidTemplateKey(key: unknown): key is string {
  return typeof key === "string" && CONTRACT_TEMPLATE_KEYS.includes(key);
}
