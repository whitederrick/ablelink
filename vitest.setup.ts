// server-only 모듈 모킹 (Next.js 서버 전용 패키지)
import { vi } from "vitest";
vi.mock("server-only", () => ({}));
