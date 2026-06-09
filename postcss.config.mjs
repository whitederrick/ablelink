// Tailwind v4는 색을 oklch(), 투명도(bg-white/20 등)를 color-mix()로 출력 → 구버전
// 브라우저(Chrome/Edge <111, Safari <16.4)에서 색·레이아웃이 깨진다.
// @tailwindcss/postcss 뒤에서 rgb 폴백을 주입(preserve:true = 최신은 oklch 유지, 구버전은 폴백 사용).
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    // preserve:false = oklch/color-mix를 rgb로 치환(변수 정의 포함) → 구버전도 색 표시.
    // (Tailwind v4는 색을 --color-* 변수로 정의해 preserve:true면 변수 안 oklch가 안 바뀜)
    "@csstools/postcss-oklab-function": { preserve: false, subFeatures: { displayP3: false } },
    "@csstools/postcss-color-mix-function": { preserve: false },
  },
};

export default config;
