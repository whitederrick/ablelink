import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  // 운영 환경에서만 활성화
  enabled: process.env.NODE_ENV === "production",
  tracesSampleRate: 0.1,         // 10% 트레이스 수집
  replaysOnErrorSampleRate: 1.0, // 에러 발생 시 100% 세션 리플레이
  replaysSessionSampleRate: 0.0, // 일반 세션 리플레이는 비활성화
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: false,
    }),
  ],
});
