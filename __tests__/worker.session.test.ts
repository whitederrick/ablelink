import { describe, it, expect, beforeAll } from "vitest";
import { signWorkerToken, verifyWorkerToken } from "@/app/worker/_lib/session";
import { SignJWT } from "jose";

const WORKER_SECRET = "worker-secret-32-chars-long-ok!!";

beforeAll(() => {
  process.env.WORKER_SESSION_SECRET = WORKER_SECRET;
});

describe("signWorkerToken / verifyWorkerToken", () => {
  it("정상 토큰 발급 후 검증 성공", async () => {
    const token = await signWorkerToken({ userId: "100", userName: "홍길동" });
    const result = await verifyWorkerToken(token);

    expect(result).not.toBeNull();
    expect(result!.userId).toBe("100");
    expect(result!.userName).toBe("홍길동");
  });

  it("isTemporary 필드 포함", async () => {
    const token = await signWorkerToken({ userId: "200", userName: "임시사용자", isTemporary: true });
    const result = await verifyWorkerToken(token);
    expect(result!.isTemporary).toBe(true);
  });

  it("잘못된 서명 → null 반환", async () => {
    const token = await signWorkerToken({ userId: "1", userName: "test" });
    const tampered = token.slice(0, -5) + "XXXXX";
    expect(await verifyWorkerToken(tampered)).toBeNull();
  });

  it("만료된 토큰 → null 반환", async () => {
    const key = new TextEncoder().encode(WORKER_SECRET);
    const expired = await new SignJWT({ userId: "1", userName: "test", role: "COACH" })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("ablelink-worker")
      .setIssuedAt()
      .setExpirationTime("-1s")
      .sign(key);
    expect(await verifyWorkerToken(expired)).toBeNull();
  });

  it("[보안] audience 없는 구 토큰 → null 반환 (fallback 제거 확인)", async () => {
    const key = new TextEncoder().encode(WORKER_SECRET);
    const oldToken = await new SignJWT({ userId: "1", userName: "test", role: "COACH" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(key);
    expect(await verifyWorkerToken(oldToken)).toBeNull();
  });

  it("[보안] role이 COACH 아닌 토큰 → null 반환", async () => {
    const key = new TextEncoder().encode(WORKER_SECRET);
    const adminToken = await new SignJWT({ userId: "1", userName: "admin", role: "ADMIN" })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("ablelink-worker")
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(key);
    expect(await verifyWorkerToken(adminToken)).toBeNull();
  });

  it("[보안] Admin 시크릿으로 서명된 Worker 토큰 → null 반환", async () => {
    const adminKey = new TextEncoder().encode("different-admin-secret-32chars!!!");
    const forgedToken = await new SignJWT({ userId: "1", userName: "attacker", role: "COACH" })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("ablelink-worker")
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(adminKey);
    expect(await verifyWorkerToken(forgedToken)).toBeNull();
  });

  it("[보안] WORKER_SESSION_SECRET 미설정 시 예외 발생", async () => {
    const orig = process.env.WORKER_SESSION_SECRET;
    delete process.env.WORKER_SESSION_SECRET;
    // verifyWorkerToken은 async이므로 rejected promise 형태로 throw
    await expect(verifyWorkerToken("anytoken")).rejects.toThrow("WORKER_SESSION_SECRET is not set");
    process.env.WORKER_SESSION_SECRET = orig;
  });
});
