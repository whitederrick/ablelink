"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ClipboardList, FileWarning } from "lucide-react";

type TrainingType = "PRE" | "FIELD" | "ADAPTATION";

interface Trainee {
  id: string;
  name: string;
  gender: string;
}

interface MissingLog {
  attendanceId: string;
  workDate: string;
  siteName: string;
  trainingType: TrainingType;
  trainees: Trainee[];
}

const TYPE_LABEL: Record<TrainingType, string> = {
  PRE:        "사전훈련",
  FIELD:      "현장훈련",
  ADAPTATION: "적응지도",
};
const TYPE_COLOR: Record<TrainingType, string> = {
  PRE:        "bg-sky-100 text-sky-700",
  FIELD:      "bg-emerald-100 text-emerald-700",
  ADAPTATION: "bg-violet-100 text-violet-700",
};

function formatDate(d: string) {
  const date = new Date(d + "T00:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d} (${days[date.getDay()]})`;
}

// 훈련생 1명 → 바로 작성, 여러명 → 선택 모달
function TraineePickerModal({
  item,
  onClose,
  onSelect,
}: {
  item: MissingLog;
  onClose: () => void;
  onSelect: (trainee: Trainee) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-6"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-3xl bg-white p-6">
        <p className="mb-1 text-base font-black text-slate-900">훈련생 선택</p>
        <p className="mb-5 text-sm font-semibold text-slate-400">{formatDate(item.workDate)} · {item.siteName}</p>
        <div className="space-y-2">
          {item.trainees.map(t => (
            <button
              key={t.id}
              onClick={() => onSelect(t)}
              className="flex w-full items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3.5 text-left transition active:scale-95 hover:bg-slate-100"
            >
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-200 text-sm font-black text-slate-600">
                {t.name[0]}
              </div>
              <div>
                <p className="text-sm font-black text-slate-900">{t.name}</p>
                <p className="text-xs font-semibold text-slate-400">{t.gender === "M" ? "남성" : "여성"}</p>
              </div>
            </button>
          ))}
        </div>
        <button onClick={onClose} className="mt-4 w-full rounded-2xl border border-slate-200 py-3 text-sm font-black text-slate-500">
          취소
        </button>
      </div>
    </div>
  );
}

export default function MissingLogsPage() {
  const router = useRouter();
  const [items, setItems] = useState<MissingLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState<MissingLog | null>(null);

  useEffect(() => {
    fetch("/api/worker/logs/missing")
      .then(r => r.json())
      .then(d => { if (d.success) setItems(d.attendances); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function handleWrite(item: MissingLog, trainee: Trainee) {
    const params = new URLSearchParams({
      attendanceId: item.attendanceId,
      traineeId:    trainee.id,
      traineeName:  trainee.name,
      trainingType: item.trainingType,
    });
    router.push(`/worker/worklog?${params.toString()}`);
  }

  function handleItemClick(item: MissingLog) {
    if (item.trainees.length === 0) return;
    if (item.trainees.length === 1) {
      handleWrite(item, item.trainees[0]);
    } else {
      setPicking(item);
    }
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-100 bg-white px-4 py-4">
        <button
          onClick={() => router.back()}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition active:scale-95"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div>
          <p className="text-base font-black text-slate-900">미작성 일지</p>
          <p className="text-xs font-semibold text-slate-400">최근 3개월 · 미작성 날짜</p>
        </div>
      </header>

      <div className="mx-auto max-w-md px-4 py-4 pb-10">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-100">
              <ClipboardList className="h-8 w-8 text-emerald-500" />
            </div>
            <p className="text-base font-black text-slate-900">미작성 일지 없음</p>
            <p className="text-sm font-semibold text-slate-400">최근 3개월 모든 일지가 작성되었습니다.</p>
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs font-semibold text-slate-400">{items.length}개 미작성</p>
            <div className="space-y-2.5">
              {items.map(item => (
                <div
                  key={item.attendanceId}
                  className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3.5 shadow-sm"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-amber-100">
                    <FileWarning className="h-5 w-5 text-amber-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black text-slate-900">{formatDate(item.workDate)}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${TYPE_COLOR[item.trainingType]}`}>
                        {TYPE_LABEL[item.trainingType]}
                      </span>
                      <span className="text-xs font-semibold text-slate-400 truncate">{item.siteName}</span>
                    </div>
                    {item.trainees.length > 0 && (
                      <p className="mt-0.5 text-[11px] font-semibold text-slate-400">
                        훈련생: {item.trainees.map(t => t.name).join(", ")}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleItemClick(item)}
                    disabled={item.trainees.length === 0}
                    className="flex items-center gap-1 rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white transition active:scale-95 disabled:opacity-40"
                  >
                    <ClipboardList className="h-3.5 w-3.5 text-sky-400" />
                    작성
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {picking && (
        <TraineePickerModal
          item={picking}
          onClose={() => setPicking(null)}
          onSelect={trainee => { setPicking(null); handleWrite(picking, trainee); }}
        />
      )}
    </div>
  );
}
