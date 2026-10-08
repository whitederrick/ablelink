// 워커 로그인 계정 단독 레이트리밋 — 2026-10-08 감사 P2: IP를 바꿔 가며 알려진 loginId를 무제한 두드릴 수 있었다.
import { describe, it, expect, vi } from "vitest";

const findWorker = vi.fn();
const verify = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    worker: { findUnique: (...a: unknown[]) => findWorker(...a), update: vi.fn(async () => ({})) },
    siteAssignment: { findFirst: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/password", () => ({ verifyPassword: (...a: unknown[]) => verify(...a) }));
vi.mock("@/lib/clientIp", () => ({ getRateLimitIp: (req: Request) => req.headers.get("x-ip") }));
vi.mock("@/app/worker/_lib/session", () => ({
  signWorkerToken: async () => "tok", WORKER_COOKIE: "w", workerCookieOptions: () => ({}),
}));

import { POST } from "@/app/api/worker/auth/login/route";

const login = (loginId: string, ip: string) =>
  POST(new Request("http://x/api/worker/auth/login", { method: "POST", headers: { "x-ip": ip }, body: JSON.stringify({ loginId, password: "pw-12345678" }) }));

describe("POST /api/worker/auth/login — 계정 단독 축", () => {
  it("IP를 매번 바꿔도 같은 계정 20회 실패 후엔 429(분산 IP 브루트포스 차단)", async () => {
    findWorker.mockResolvedValue(null); verify.mockResolvedValue(false);
    const id = "01011110001";
    for (let i = 1; i <= 20; i++) expect((await login(id, `10.0.0.${i}`)).status).toBe(401);
    const blocked = await login(id, "10.0.0.99");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });

  it("다른 계정은 영향받지 않는다(계정별 예산)", async () => {
    findWorker.mockResolvedValue(null); verify.mockResolvedValue(false);
    for (let i = 1; i <= 21; i++) await login("01011110002", `10.1.0.${i}`);
    expect((await login("01011110003", "10.1.1.1")).status).toBe(401);
  });

  it("로그인 성공 시 계정 축이 초기화되어 이후 실패가 다시 처음부터 집계", async () => {
    const id = "01011110004";
    findWorker.mockResolvedValue(null); verify.mockResolvedValue(false);
    for (let i = 1; i <= 19; i++) await login(id, `10.2.0.${i}`);
    findWorker.mockResolvedValue({ id: BigInt(1), password: "h", status: "ACTIVE", workerName: "홍", isTemporary: false, planType: "FREE" });
    verify.mockResolvedValue(true);
    expect((await login(id, "10.2.1.1")).status).toBe(200);
    findWorker.mockResolvedValue(null); verify.mockResolvedValue(false);
    for (let i = 1; i <= 19; i++) expect((await login(id, `10.2.2.${i}`)).status).toBe(401);
  });
});
