// lib/businessInfo.ts
// 사업자 법정 표시 정보 — 단일 출처.
// ⚠️ 공개 랜딩/약관/방침/환불 footer가 모두 이 값을 사용한다. 라이브에 즉시 반영되므로
//    "가짜값 선배포 금지". 확인된 값만 채우고, 미확보 항목은 null로 둔다(footer가 해당 줄 자동 숨김).
// 전자상거래법상 통신판매업자는 상호·대표자·사업자등록번호·주소·연락처·통신판매업 신고번호 등을
// 소비자가 쉽게 확인할 수 있는 화면에 표시해야 한다. (PG 심사에도 동일 표시 요구)

export interface BusinessInfo {
  serviceName: string;
  companyName: string;            // 상호(등록 한글 상호) — 약관/방침 본문에 사용
  companyNameEn: string | null;   // 영문 상호(병기용) — 상호 표시줄·영문 카피라이트
  representative: string | null;  // 대표자명
  bizRegNo: string | null;        // 사업자등록번호
  mailOrderNo: string | null;     // 통신판매업 신고번호 (구매안전서비스 이용확인증 → 신고 후 부여)
  address: string | null;         // 사업장 주소
  phone: string | null;           // 고객센터 전화
  email: string | null;           // 문의 이메일
  hosting: string | null;         // 호스팅 제공자(투명성)
  privacyOfficer: string | null;  // 개인정보 보호책임자
}

// 미확보(null) 항목은 footer에서 자동 숨김. 실값 확보 시 이 한 곳만 채우고 배포하면 전체 반영.
export const BUSINESS_INFO: BusinessInfo = {
  serviceName: "Able-Link",
  companyName: "플랫포레스트",
  companyNameEn: "Platforest",
  representative: "곽은하",
  bizRegNo: "197-86-02010",
  mailOrderNo: null,      // TODO: 제0000-지역-0000호 (통신판매업 신고 후)
  address: "서울특별시 금천구 디지털로 130, 13층 1309호 (가산동, 남성프라자)",
  phone: "010-8484-7141",
  email: "platforest.inc@gmail.com", // 문의용(회신 가능). 도메인 메일함은 보류(신규 도메인 무료전달 다 막힘) — 우선 gmail 직접 표기
  hosting: "Vercel Inc.",
  privacyOfficer: "곽은하(대표)",
};

// footer 등에서 "라벨: 값"으로 뿌릴 때 null은 빼고 채워진 항목만 반환.
export function businessInfoRows(b: BusinessInfo = BUSINESS_INFO): { label: string; value: string }[] {
  const rows: { label: string; value: string | null }[] = [
    { label: "상호", value: b.companyNameEn ? `${b.companyName}(${b.companyNameEn})` : b.companyName },
    { label: "대표자", value: b.representative },
    { label: "사업자등록번호", value: b.bizRegNo },
    { label: "통신판매업 신고번호", value: b.mailOrderNo },
    { label: "주소", value: b.address },
    { label: "고객센터", value: b.phone },
    { label: "이메일", value: b.email },
    { label: "개인정보 보호책임자", value: b.privacyOfficer },
    { label: "호스팅 제공", value: b.hosting },
  ];
  return rows.filter((r): r is { label: string; value: string } => !!r.value && r.value.trim() !== "");
}
