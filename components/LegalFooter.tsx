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

export default function LegalFooter() {
  const rows = businessInfoRows();
  return (
    <footer className="mt-8 border-t border-slate-200 pt-5 text-center text-slate-400">
      <nav className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs font-bold text-slate-500">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="hover:text-slate-700">{l.label}</Link>
        ))}
      </nav>

      {/* 사업자정보 — 확보분만 한 줄(·구분)로 가운데 정렬, 좁으면 자동 줄바꿈 */}
      {rows.length > 0 && (
        <p className="mt-4 text-[11px] font-semibold leading-5 text-slate-500">
          {rows.map((r, i) => (
            <span key={r.label}>
              {i > 0 && <span className="px-1.5 text-slate-300">·</span>}
              <span className="text-slate-400">{r.label}</span> {r.value}
            </span>
          ))}
        </p>
      )}

      <p className="mt-3 text-[11px] font-semibold text-slate-400">
        © 2026 {BUSINESS_INFO.serviceName} · Provided by {BUSINESS_INFO.companyNameEn ?? BUSINESS_INFO.companyName}
      </p>
    </footer>
  );
}
