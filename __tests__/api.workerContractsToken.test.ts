// 토큰 기반 계약 조회·서명 — 2026-10-08 감사 P2: 무제한 조회·취소 계약에서도 서명 이미지 반환·내용 검증 없는 서명 저장.
import { describe, it, expect, vi, beforeEach } from "vitest";

const contractFind = vi.fn();
const imgToUri = vi.fn();
const rateFn = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { employmentContract: { findUnique: (...a: unknown[]) => contractFind(...a) } } }));
vi.mock("@/lib/signatureImage", () => ({ imageToDataUri: (...a: unknown[]) => imgToUri(...a) }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: (...a: unknown[]) => rateFn(...a) }));
vi.mock("@/lib/clientIp", () => ({ getRateLimitIp: () => "1.2.3.4" }));
vi.mock("@/lib/kakao", () => ({ sendAlimtalk: vi.fn() }));
vi.mock("@/lib/assignmentLock", () => ({ withSiteAndWorkersAssignmentLock: vi.fn() }));
vi.mock("@/lib/assignmentCapacity", () => ({ checkSiteCapacity: vi.fn() }));
vi.mock("bcryptjs", () => ({ hash: vi.fn() }));

import { GET, POST } from "@/app/api/worker/contracts/route";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHDCc2QAAAABJRU5ErkJggg==";
const row = (status: string) => ({
  id: BigInt(1), status, tokenExpiresAt: new Date(Date.now() + 86400000), signToken: "t",
  user: { workerName: "홍", phoneNumber: "010", signatureUrl: "path/sig.png" },
  agency: { name: "기관", address: "a", phoneNumber: "02" },
  contractStart: new Date("2026-10-01"), contractEnd: new Date("2026-12-31"),
  workType: "FULL_DAY", specialClauses: [], workerSignedAt: null, adminSignedAt: null,
});
const get = () => GET(new Request("http://x/api/worker/contracts?token=t") as never);
const post = (body: object) => POST(new Request("http://x/api/worker/contracts", { method: "POST", body: JSON.stringify({ token: "t", ...body }) }) as never);

describe("GET /api/worker/contracts (토큰)", () => {
  beforeEach(() => {
    contractFind.mockReset(); imgToUri.mockReset(); rateFn.mockReset();
    rateFn.mockResolvedValue({ allowed: true });
    imgToUri.mockResolvedValue(PNG);
  });

  it("서명 가능(PENDING)이면 저장된 서명 자동 채움용 이미지를 반환(기존 기능 유지)", async () => {
    contractFind.mockResolvedValue(row("PENDING"));
    const body = await (await get()).json();
    expect(body.data.savedSignatureUrl).toBe(PNG);
  });

  it("취소·서명완료 계약은 서명 이미지를 반환하지 않고 변환 호출도 하지 않는다", async () => {
    for (const st of ["CANCELLED", "SIGNED", "COMPLETED"]) {
      imgToUri.mockClear();
      contractFind.mockResolvedValue(row(st));
      const body = await (await get()).json();
      expect(body.data.savedSignatureUrl).toBeNull();
      expect(imgToUri).not.toHaveBeenCalled();
    }
  });

  it("IP 예산 초과면 DB 조회 없이 429", async () => {
    rateFn.mockResolvedValue({ allowed: false });
    const res = await get();
    expect(res.status).toBe(429);
    expect(contractFind).not.toHaveBeenCalled();
  });
});

describe("POST /api/worker/contracts (서명 제출) — 입력 검증", () => {
  beforeEach(() => { contractFind.mockReset(); rateFn.mockReset(); rateFn.mockResolvedValue({ allowed: true }); });

  it("IP 예산 초과면 429", async () => {
    rateFn.mockResolvedValue({ allowed: false });
    expect((await post({ signatureUrl: PNG })).status).toBe(429);
  });

  it("SVG·임의 바이트는 서명으로 받지 않는다(PDF에서 빠지는 '서명완료' 방지)", async () => {
    const svg = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";
    const fakePng = "data:image/png;base64," + Buffer.from("not really a png at all......").toString("base64");
    for (const bad of [svg, fakePng, "data:image/png;base64,", 12345]) {
      const res = await post({ signatureUrl: bad });
      expect(res.status).toBe(400);
    }
    expect(contractFind).not.toHaveBeenCalled();
  });

  it("정상 PNG는 검증을 통과해 계약 조회 단계로 진행", async () => {
    contractFind.mockResolvedValue(null);
    const res = await post({ signatureUrl: PNG });
    expect(res.status).toBe(404); // 유효하지 않은 토큰 — 이미지 검증은 통과했다는 뜻
    expect(contractFind).toHaveBeenCalledTimes(1);
  });
});
