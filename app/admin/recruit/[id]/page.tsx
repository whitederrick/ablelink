"use client";
// 직무지도 공고 신청자 — deep-link 페이지(공용 본문 RecruitDetailBody 사용)
import { useParams, useRouter } from "next/navigation";
import RecruitDetailBody from "../RecruitDetailBody";

export default function ManagerRecruitApplicantsPage() {
  const router = useRouter();
  const params = useParams();
  const id = String(params.id);
  return (
    <div>
      <button onClick={() => router.push("/admin/recruit")} className="mb-3 text-sm font-bold text-slate-400 hover:text-slate-600">← 공고 목록</button>
      <RecruitDetailBody id={id} />
    </div>
  );
}
