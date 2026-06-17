// scripts/seed-jobcoach-eval-form.mts
// 직무지도원 역량 평가표(운영자 소유 기준) 기본본 시드.
//  - JobCoachEvalForm/Category/Question 구조에 제안 평가표(6개 카테고리, 배점 합계 100)를 생성하고 활성화.
//  - 동일 제목 폼이 이미 있으면 건너뜀(중복 방지). 운영자는 이후 /admin/eval-forms 에서 편집 가능.
// 실행: npx tsx scripts/seed-jobcoach-eval-form.mts

import { readFileSync } from "node:fs";

// .env 로드(운영 DB) — 다른 시드 스크립트와 동일 패턴
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const TITLE = "직무지도원 역량 평가표 (v1)";

// 배점(maxScore) = 카테고리 가중치 기여분. 문항은 1~5로 답하고 (응답/5)×배점으로 환산, 전체 합계 100.
const CATEGORIES: { name: string; questions: { text: string; maxScore: number }[] }[] = [
  { name: "근태·성실성", questions: [
    { text: "약속한 출근·근무시간을 준수했다", maxScore: 8 },
    { text: "부재·일정 변경 시 사전에 충실히 공유했다", maxScore: 7 },
  ] },
  { name: "장애 직무지도 전문성", questions: [
    { text: "훈련생의 장애 특성을 이해하고 그에 맞게 지도했다", maxScore: 9 },
    { text: "직무를 단계로 나눠 알기 쉽게 가르쳤다", maxScore: 8 },
    { text: "훈련생의 숙련·독립 수행이 향상되도록 도왔다", maxScore: 8 },
  ] },
  { name: "대상자 관리·정서지원", questions: [
    { text: "훈련생을 존중하고 정서적으로 안정시켰다", maxScore: 10 },
    { text: "돌발 상황(행동·안전)에 침착하게 대응했다", maxScore: 10 },
  ] },
  { name: "현장 협업·소통", questions: [
    { text: "사업체 담당자와 소통·협조가 원활했다", maxScore: 10 },
    { text: "현장 규칙·업무 흐름을 존중하고 맞췄다", maxScore: 10 },
  ] },
  { name: "직업윤리·신뢰", questions: [
    { text: "비밀유지·개인정보 등 직업윤리를 지켰다", maxScore: 5 },
    { text: "책임감 있게 약속을 이행했다", maxScore: 5 },
  ] },
  { name: "종합 추천", questions: [
    { text: "향후 우리 현장에 이 직무지도원을 다시 받고 싶다", maxScore: 10 },
  ] },
];

async function main() {
  const total = CATEGORIES.flatMap(c => c.questions).reduce((s, q) => s + q.maxScore, 0);
  if (total !== 100) throw new Error(`배점 합계가 100이 아닙니다: ${total}`);

  const existing = await prisma.jobCoachEvalForm.findFirst({ where: { title: TITLE } });
  if (existing) {
    console.log(`이미 존재하는 평가표라 건너뜁니다 (id=${existing.id}, active=${existing.isActive}).`);
    return;
  }

  await prisma.$transaction(async tx => {
    // 단일 활성 보장: 기존 활성 해제 후 새 폼 활성화
    await tx.jobCoachEvalForm.updateMany({ data: { isActive: false } });
    const form = await tx.jobCoachEvalForm.create({
      data: {
        title: TITLE,
        description: "장애인 직무지도원의 현장 역량 평가. 사업체 담당자가 근무 종료 시 작성합니다. (운영자 관리·결과 비공개)",
        includeOpinion: true,
        isActive: true,
      },
    });
    for (let ci = 0; ci < CATEGORIES.length; ci++) {
      const c = CATEGORIES[ci];
      const cat = await tx.jobCoachEvalCategory.create({ data: { formId: form.id, name: c.name, sortOrder: ci } });
      for (let qi = 0; qi < c.questions.length; qi++) {
        const q = c.questions[qi];
        await tx.jobCoachEvalQuestion.create({ data: { categoryId: cat.id, text: q.text, maxScore: q.maxScore, sortOrder: qi } });
      }
    }
    console.log(`생성·활성화 완료 (form id=${form.id}, 카테고리 ${CATEGORIES.length}개, 배점 합계 ${total}).`);
  });
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
