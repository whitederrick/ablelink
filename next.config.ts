// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ✅ pdfkit이 Turbopack 번들 경로(C:\#ROOT#\...)를 타지 않도록
  //    서버 번들에서 제외하고 런타임에 node_modules에서 로드하게 함
  serverExternalPackages: ["pdfkit", "playwright"], // ✅ 중요: 서버 번들에서 제외
};

export default nextConfig;
