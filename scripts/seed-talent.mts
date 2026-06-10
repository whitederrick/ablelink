// scripts/seed-talent.mts
// 인재풀(구직중 직무지도원) 샘플 데이터 시드 — 화면 확인용.
// 실행: npx tsx scripts/seed-talent.mts
// loginId "talent-sampleN" 기준 upsert(재실행 안전). 제거: 동일 loginId 워커 삭제.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

type Exp = { org: string; title?: string; start: string; end?: string; desc?: string };
type Rev = { rating: number; comment?: string; ym: string };
type Sample = {
  name: string; phone: string; region: string; years: number; birth: string;
  verify: "VERIFIED" | "PENDING"; ratingAvg: number; ratingCount: number;
  premium?: boolean; bio: string;
  experiences?: Exp[]; reviews?: Rev[];
};

const SAMPLES: Sample[] = [
  { name: "김지훈", phone: "01045000001", region: "서울특별시 강남구 테헤란로 123", years: 5, birth: "1991-03-12", verify: "VERIFIED", ratingAvg: 4.8, ratingCount: 12, premium: true,
    bio: "중증 지적장애인 직무지도 5년. 제조·사무 직무 적응 지원 전문. 출퇴근 지도와 훈련일지 작성에 강점이 있습니다." },
  { name: "이수민", phone: "01045000002", region: "경기도 성남시 분당구 판교로 45", years: 3, birth: "1996-07-25", verify: "VERIFIED", ratingAvg: 4.5, ratingCount: 8,
    bio: "발달장애 청년 직무 적응·출퇴근 지도 경험 다수. 사업체 담당자와의 소통을 중요하게 생각합니다." },
  { name: "박준영", phone: "01045000003", region: "인천광역시 부평구 부평대로 77", years: 7, birth: "1984-11-03", verify: "VERIFIED", ratingAvg: 4.9, ratingCount: 20, premium: true,
    bio: "지원고용·취업 후 적응지도 통합 운영. 카페·물류 직무 매칭 성공 사례 다수 보유." },
  { name: "최은영", phone: "01045000004", region: "서울특별시 노원구 동일로 1234", years: 1, birth: "1999-02-18", verify: "PENDING", ratingAvg: 0, ratingCount: 0,
    bio: "사회복지사 2급. 신규 직무지도원으로 성실하게 배우며 현장에 빠르게 적응하겠습니다." },
  { name: "정민재", phone: "01045000005", region: "부산광역시 해운대구 센텀중앙로 90", years: 4, birth: "1988-09-30", verify: "VERIFIED", ratingAvg: 4.2, ratingCount: 6,
    bio: "지적·자폐성 장애 직무지도. 외식업 적응지원에 강점이 있으며 보호자 상담 경험이 풍부합니다." },
  { name: "한서연", phone: "01045000006", region: "대구광역시 수성구 동대구로 22", years: 2, birth: "1994-05-08", verify: "PENDING", ratingAvg: 4.0, ratingCount: 3,
    bio: "특수교육 전공. 훈련일지·종합평가 문서화가 꼼꼼하고 데이터 기반 지도를 지향합니다." },
  { name: "오태경", phone: "01045000007", region: "경기도 고양시 일산동구 중앙로 1100", years: 6, birth: "1980-12-21", verify: "VERIFIED", ratingAvg: 4.7, ratingCount: 15, premium: true,
    bio: "공공기관 사무보조 직무지도 다수. 장기 근속으로 이어진 매칭 사례를 다수 보유하고 있습니다." },
];

async function main() {
  const hash = await bcrypt.hash("sample1234!", 12);
  let n = 0;
  for (let i = 0; i < SAMPLES.length; i++) {
    const s = SAMPLES[i];
    const loginId = `talent-sample${i + 1}`;
    const worker = await prisma.worker.upsert({
      where: { loginId },
      update: {
        workerName: s.name, phoneNumber: s.phone, status: "ACTIVE",
        openToOffers: true, residenceAddress: s.region, bio: s.bio, birthDate: s.birth,
        ratingAvg: s.ratingAvg, ratingCount: s.ratingCount,
        planType: s.premium ? "PRO" : "FREE",
      },
      create: {
        loginId, password: hash, workerName: s.name, phoneNumber: s.phone,
        status: "ACTIVE", openToOffers: true, residenceAddress: s.region, bio: s.bio, birthDate: s.birth,
        ratingAvg: s.ratingAvg, ratingCount: s.ratingCount,
        planType: s.premium ? "PRO" : "FREE",
      },
    });
    await prisma.workerProfession.upsert({
      where: { workerId_profession: { workerId: worker.id, profession: "JOB_COACH" } },
      update: { experienceYears: s.years, isPrimary: true, isActive: true, verifyStatus: s.verify },
      create: { workerId: worker.id, profession: "JOB_COACH", experienceYears: s.years, isPrimary: true, isActive: true, verifyStatus: s.verify },
    });

    // 경력 이력 — 명시값 없으면 연차 기반 자동 생성 (재실행 안전: 기존 삭제 후 재삽입)
    const city = s.region.split(/\s+/)[0] ?? "";
    const ORG_POOL = ["○○제조", "△△물류센터", "□□카페", "◇◇사무지원센터", "공공기관 행정지원"];
    const exps: Exp[] = s.experiences ?? (s.years >= 3
      ? [
          { org: `${city} ${ORG_POOL[i % ORG_POOL.length]}`, title: "직무지도원", start: `${2025 - Math.min(s.years, 6)}-03`, end: `${2024}-02`, desc: "지원고용 현장훈련·출퇴근 지도·훈련일지 작성" },
          { org: `${city} ${ORG_POOL[(i + 2) % ORG_POOL.length]}`, title: "적응지도 담당", start: `${2024}-03`, desc: "취업 후 적응지도·사업체 담당자 협업" },
        ]
      : s.years >= 1
      ? [{ org: `${city} ${ORG_POOL[i % ORG_POOL.length]}`, title: "직무지도원", start: `${2025 - s.years}-06`, desc: "현장훈련 보조·일지 작성" }]
      : []);
    await prisma.workerExperience.deleteMany({ where: { workerId: worker.id } });
    if (exps.length > 0) {
      await prisma.workerExperience.createMany({
        data: exps.map(e => ({
          workerId: worker.id, profession: "JOB_COACH" as const, orgName: e.org, title: e.title ?? null,
          startDate: new Date(`${e.start}-01T00:00:00Z`), endDate: e.end ? new Date(`${e.end}-01T00:00:00Z`) : null,
          description: e.desc ?? null,
        })),
      });
    }

    // 후기 — 명시값 없으면 ratingCount/ratingAvg 기반 자동 생성
    const COMMENTS = ["성실하고 소통이 원활했습니다.", "훈련생 적응을 꼼꼼히 도와주셨어요.", "일지·평가 문서가 정확했습니다.", "사업체와의 조율이 매끄러웠습니다."];
    const revs: Rev[] = s.reviews ?? Array.from({ length: Math.min(s.ratingCount, 6) }, (_, k) => ({
      rating: Math.max(3, Math.min(5, Math.round(s.ratingAvg + (k % 2 === 0 ? 0 : -0.3)))),
      comment: k < 3 ? COMMENTS[k % COMMENTS.length] : undefined,
      ym: `2025-${String(((k % 6) + 1)).padStart(2, "0")}`,
    }));
    await prisma.workerReview.deleteMany({ where: { workerId: worker.id } });
    if (revs.length > 0) {
      await prisma.workerReview.createMany({
        data: revs.map(r => ({
          workerId: worker.id, rating: r.rating, comment: r.comment ?? null,
          createdAt: new Date(`${r.ym}-15T00:00:00Z`), updatedAt: new Date(`${r.ym}-15T00:00:00Z`),
        })),
      });
    }
    n++;
    console.log(`  ✓ ${s.name} (${s.region.split(/\s+/).slice(0, 2).join(" ")}) · ${s.years}년 · ${s.verify} · ★${s.ratingAvg}`);
  }
  console.log(`\n인재풀 샘플 ${n}명 시드 완료. (로그인 비번: sample1234!)`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
