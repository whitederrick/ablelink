// 매니저 콘솔 공용 표기 헬퍼 — 직무지도원 식별자 표기를 전 화면 통일.
// 표준: "직무지도원 성명(아이디)" / 아이디는 개인정보 보호를 위해 마스킹.

export function maskLoginId(id: string | null | undefined): string {
  if (!id) return "";
  if (id.includes("@")) {
    const [local, domain] = id.split("@");
    if (local.length <= 2) return id;
    return `${local[0]}${"*".repeat(Math.min(local.length - 2, 4))}${local[local.length - 1]}@${domain}`;
  }
  const digits = id.replace(/\D/g, "");
  if (digits.length >= 10) return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
  return id;
}

// 성명(아이디) 표준 표기. 아이디가 없으면 성명만.
export function workerLabel(name: string | null | undefined, loginId: string | null | undefined): string {
  const n = name || "-";
  const id = maskLoginId(loginId);
  return id ? `${n}(${id})` : n;
}
