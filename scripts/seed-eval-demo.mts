// scripts/seed-eval-demo.mts
// 직무지도원 평가 관리 데모 — 종료 배정 + 평가 3종 상태(미요청/요청/완료) 생성.
import { prisma } from "../lib/prisma";
import crypto from "crypto";

const FORM = {
  title: "직무지도원 역량 평가표",
  includeOpinion: true,
  categories: [
    { name: "전문성", weight: 50, questions: [{ text: "직무 지식과 지도 역량", maxScore: 5 }, { text: "문제 상황 대처", maxScore: 5 }] },
    { name: "성실성·소통", weight: 50, questions: [{ text: "근태·성실성", maxScore: 5 }, { text: "사업체와의 소통", maxScore: 5 }] },
  ],
};
const COMMENTS = ["성실하게 지도해 주셨습니다.", "훈련생 적응에 큰 도움이 되었습니다.", "소통이 원활하고 전문적이었습니다."];

function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d; }

async function main() {
  const agencies = await prisma.agency.findMany({ select: { id: true } });
  let ended = 0, made = 0;

  for (const ag of agencies) {
    // 기관별 ACTIVE 배정 중 평가가 없는 것 3건 선택
    const asgs = await prisma.siteAssignment.findMany({
      where: { agencyId: ag.id, status: "ACTIVE", endDate: null },
      select: { id: true, workerId: true, site: { select: { companyName: true, businessContactName: true, businessContactPhone: true } } },
      take: 3, orderBy: { id: "asc" },
    });

    for (let i = 0; i < asgs.length; i++) {
      const a = asgs[i];
      const end = daysAgo(5 + i * 9); // 5, 14, 23일 전 종료
      await prisma.siteAssignment.update({ where: { id: a.id }, data: { status: "ENDED", endDate: end, endedAt: end } });
      ended++;

      const kind = i % 3; // 0=미요청, 1=요청, 2=완료
      if (kind === 0) continue;

      const base = {
        agencyId: ag.id, workerId: a.workerId, assignmentId: a.id,
        recipientName: a.site?.businessContactName ?? "현장담당",
        recipientPhone: a.site?.businessContactPhone ?? "010-0000-0000",
        siteName: a.site?.companyName ?? null,
        token: crypto.randomUUID(),
        formId: null as any, formSnapshot: FORM as any,
        expiresAt: daysAgo(-14), sentAt: new Date(end.getTime() + 86400000),
      };

      if (kind === 1) {
        await prisma.satisfactionSurvey.create({ data: { ...base, status: "PENDING", auto: false } as any });
      } else {
        const scores = { "0_0": 5, "0_1": 4, "1_0": 5, "1_1": 4 };
        const categoryScores = [{ name: "전문성", weight: 50, score: 45 }, { name: "성실성·소통", weight: 50, score: 42 }];
        await prisma.satisfactionSurvey.create({
          data: {
            ...base, status: "RESPONDED", auto: false,
            scores: scores as any, comment: COMMENTS[i % COMMENTS.length],
            categoryScores: categoryScores as any, totalScore: 87,
            respondedAt: new Date(end.getTime() + 3 * 86400000), sharedWithAgency: i % 2 === 0,
          } as any,
        });
      }
      made++;
    }
  }
  console.log(`종료 배정 ${ended}건 · 평가(요청/완료) ${made}건 생성`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
