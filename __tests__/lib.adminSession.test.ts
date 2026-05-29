import { describe, it, expect, beforeAll } from "vitest";
import {
  signAdminSessionToken,
  verifyAdminSessionToken,
  type AdminSessionPayload,
} from "@/lib/adminSession";
import { SignJWT } from "jose";

const SECRET = "test-secret-32-chars-long-enough!";

beforeAll(() => {
  process.env.ADMIN_SESSION_SECRET = SECRET;
});

const basePayload: AdminSessionPayload = {
  sub: "1",
  loginId: "sysadmin",
};

describe("signAdminSessionToken / verifyAdminSessionToken", () => {
  it("정상 토큰 발급 후 검증 성공", async () => {
    const token = await signAdminSessionToken(basePayload);
    const result = await verifyAdminSessionToken(token);

    expect(result).not.toBeNull();
    expect(result!.sub).toBe("1");
    expect(result!.loginId).toBe("sysadmin");
  });

  it("잘못된 서명 → null 반환", async () => {
    const token = await signAdminSessionToken(basePayload);
    const tampered = token.slice(0, -5) + "XXXXX";
    const result = await verifyAdminSessionToken(tampered);
    expect(result).toBeNull();
  });

  it("만료된 토큰 → null 반환", async () => {
    const key = new TextEncoder().encode(SECRET);
    const expired = await new SignJWT({ ...basePayload })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("ablelink-admin")
      .setIssuedAt()
      .setExpirationTime("-1s")
      .sign(key);
    const result = await verifyAdminSessionToken(expired);
    expect(result).toBeNull();
  });

  it("[보안] audience 없는 구 토큰 → null 반환 (fallback 제거 확인)", async () => {
    const key = new TextEncoder().encode(SECRET);
    const oldToken = await new SignJWT({ ...basePayload })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(key);
    const result = await verifyAdminSessionToken(oldToken);
    expect(result).toBeNull();
  });

  it("[보안] 다른 audience → null 반환", async () => {
    const key = new TextEncoder().encode(SECRET);
    const wrongAud = await new SignJWT({ ...basePayload })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("ablelink-worker")
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(key);
    const result = await verifyAdminSessionToken(wrongAud);
    expect(result).toBeNull();
  });

  it("[보안] sub 없는 토큰 → null 반환", async () => {
    const key = new TextEncoder().encode(SECRET);
    const noSub = await new SignJWT({ loginId: "test" })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("ablelink-admin")
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(key);
    const result = await verifyAdminSessionToken(noSub);
    expect(result).toBeNull();
  });
});
