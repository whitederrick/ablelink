"use client";

// 직무지도 모집 공고 상세 모달 — 목록 행 클릭 시 등록 정보를 읽기전용으로 조회.
// 데이터는 목록 GET이 이미 전부 반환하므로 추가 조회 없이 post 객체를 그대로 표시.
import { X } from "lucide-react";
import { T } from "../_styles";
import type { Post } from "./types";

const PROF_LABEL: Record<string, string> = {
  JOB_COACH: "직무지도원", CAREGIVER: "요양보호사", ACTIVITY_ASSISTANT: "활동지원사",
};

function Field({ label, value, full }: { label: string; value: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <p className="text-xs font-black text-slate-400">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap break-words text-sm font-semibold text-slate-800">{value}</p>
    </div>
  );
}

export default function RecruitPostDetailModal({ post, onClose, onViewApplicants, onToggleStatus }: {
  post: Post;
  onClose: () => void;
  onViewApplicants: () => void;
  onToggleStatus: () => void;
}) {
  const open = post.status === "OPEN";
  const period = post.serviceStart && post.serviceEnd
    ? `${post.serviceStart} ~ ${post.serviceEnd}`
    : (post.serviceStart || post.serviceEnd || "-");
  const fullAddress = [post.address, post.detailAddress].filter(Boolean).join(" ") || "-";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-black text-slate-900">{post.title}</h2>
              <span className={`${T.badge} ${open ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>{open ? "모집중" : "마감"}</span>
            </div>
            <p className="mt-0.5 truncate text-[13px] font-semibold text-slate-400">{post.companyName}</p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-xl border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5" /></button>
        </div>

        {/* 등록 정보 */}
        <div className={`${T.card} space-y-4`}>
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Field label="사업체명" value={post.companyName || "-"} />
            <Field label="직종" value={PROF_LABEL[post.profession] ?? post.profession} />
            <Field label="직무지도 과제(사업명)" value={post.taskName || "-"} full />
            <Field label="주소" value={fullAddress} full />
            <Field label="지역" value={post.region || "-"} />
            <Field label="직무지도 기간" value={period} />
            <Field label="근무시간" value={post.workHours || "-"} />
            <Field label="근무요일" value={post.workDays || "-"} />
            <Field label="급여" value={post.payInfo || "-"} />
            <Field label="모집 인원" value={`${post.headcount}명`} />
            <Field label="담당자" value={post.contactName || "-"} />
            <Field label="담당자 연락처" value={post.contactPhone || "-"} />
            <Field label="등록일" value={post.createdAt.slice(0, 10)} />
          </div>
          {post.description && (
            <div className="border-t border-slate-100 pt-3">
              <p className="text-xs font-black text-slate-400">상세 설명</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold text-slate-700">{post.description}</p>
            </div>
          )}
        </div>

        {/* 액션 */}
        <div className="mt-5 flex items-center gap-2">
          <button onClick={onToggleStatus} className={T.btnSecondary}>{open ? "공고 마감" : "공고 재개"}</button>
          <div className="ml-auto flex gap-2">
            <button onClick={onClose} className={T.btnSecondary}>닫기</button>
            <button onClick={onViewApplicants} className={T.btnPrimary}>지원자 현황 보기 ({post.applicationCount ?? 0}건)</button>
          </div>
        </div>
      </div>
    </div>
  );
}
