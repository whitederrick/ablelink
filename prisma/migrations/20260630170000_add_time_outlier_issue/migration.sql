-- 근태 이슈 유형에 '출퇴근 시간 이상'(TIME_OUTLIER) 추가 (지각과 별개: 시각 역전·표준 대비 극단 이탈)
-- 추가형 enum 값(기존 데이터·동작 영향 없음). IF NOT EXISTS로 재실행 안전.
ALTER TYPE "AttendanceIssueType" ADD VALUE IF NOT EXISTS 'TIME_OUTLIER';
