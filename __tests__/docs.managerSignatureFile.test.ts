import { describe, it, expect, vi, beforeEach } from "vitest";

const count = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { documentRun: { count: (...a: unknown[]) => count(...a) } } }));

import { isManagerSignatureInUse } from "@/lib/docs/managerSignatureFile";

const URL = "https://x.supabase.co/storage/v1/object/public/signatures/admin/1/signature_1.png";

describe("isManagerSignatureInUse — 서명 파일 삭제 안전 판정(2026-10-08 P1)", () => {
  beforeEach(() => {
    count.mockReset();
  });

  it("서명된 문서(run)가 참조 중이면 true → 파일 삭제 금지", async () => {
    count.mockResolvedValue(3);
    expect(await isManagerSignatureInUse(URL)).toBe(true);
  });

  it("참조하는 문서가 없으면 false → 파일 삭제 허용", async () => {
    count.mockResolvedValue(0);
    expect(await isManagerSignatureInUse(URL)).toBe(false);
  });

  it("managerSignatureUrl·agencySignatureUrl 두 컬럼 모두로 조회", async () => {
    count.mockResolvedValue(0);
    await isManagerSignatureInUse(URL);
    expect(count).toHaveBeenCalledWith({
      where: { OR: [{ managerSignatureUrl: URL }, { agencySignatureUrl: URL }] },
    });
  });

  it("조회 실패 시 fail-safe: true(삭제 보류)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    count.mockImplementation(() => {
      throw new Error("db down");
    });
    const result = await isManagerSignatureInUse(URL);
    warn.mockRestore();
    expect(result).toBe(true);
  });
});
