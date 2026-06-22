// components/LegalFooter.tsx
// 공개 화면 공통 법정 표시 footer — 사업자정보(확보분만) + 약관/방침/환불/요금 링크.
// 전자상거래법·PG 심사 대응. 값은 lib/businessInfo 단일 출처(미확보 항목 자동 숨김).
import Link from "next/link";
import { BUSINESS_INFO, businessInfoRows } from "@/lib/businessInfo";

const LINKS = [
  { href: "/terms", label: "이용약관" },
  { href: "/privacy", label: "개인정보처리방침" },
  { href: "/refund", label: "환불정책" },
  { href: "/pricing", label: "요금안내" },
];

// 사업자정보 줄 구성 — 의미 단위로 묶어 줄바꿈(확보된 항목만 표시, 미확보 줄은 자동 생략).
const INFO_LINE_GROUPS: string[][] = [
  ["상호", "대표자"],
  ["사업자등록번호", "통신판매업 신고번호"],
  ["주소"],
  ["고객센터", "이메일"],
  ["개인정보 보호책임자"],
];

export default function LegalFooter() {
  const allRows = businessInfoRows();
  const byLabel = (label: string) => allRows.find((r) => r.label === label);
  // 그룹별로 확보된 행만 모으고, 비어있는 줄은 통째로 생략.
  const infoLines = INFO_LINE_GROUPS
    .map((labels) => labels.map(byLabel).filter((r): r is { label: string; value: string } => !!r))
    .filter((line) => line.length > 0);
  const hostingRow = byLabel("호스팅 제공");
  return (
    <footer className="mt-8 border-t border-slate-200 pt-5 text-center text-slate-400">
      <nav className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs font-bold text-slate-500">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="hover:text-slate-700">{l.label}</Link>
        ))}
      </nav>

      {/* 사업자정보 — 의미 단위 줄바꿈, 한 줄 안의 항목은 ·로 구분, 가운데 정렬 */}
      {infoLines.length > 0 && (
        <div className="mt-4 space-y-1 text-[11px] font-semibold leading-5 text-slate-500">
          {infoLines.map((line, li) => (
            <p key={li}>
              {line.map((r, i) => (
                <span key={r.label}>
                  {i > 0 && <span className="px-1.5 text-slate-300">·</span>}
                  <span className="text-slate-400">{r.label}</span> {r.value}
                </span>
              ))}
            </p>
          ))}
        </div>
      )}

      {/* 호스팅 제공 — 별도 줄 */}
      {hostingRow && (
        <p className="mt-1 text-[11px] font-semibold leading-5 text-slate-500">
          <span className="text-slate-400">{hostingRow.label}</span> {hostingRow.value}
        </p>
      )}

      <p className="mt-3 text-[11px] font-semibold text-slate-400">
        © 2026 {BUSINESS_INFO.serviceName} · Provided by {BUSINESS_INFO.companyNameEn ?? BUSINESS_INFO.companyName}
      </p>
    </footer>
  );
}
