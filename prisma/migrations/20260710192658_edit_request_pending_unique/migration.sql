-- #8: 한 출근기록당 PENDING(대기) 수정요청은 최대 1건.
--  동시 제출(더블탭·재시도)로 findFirst→create 사이 경합이 나면 두 PENDING 행이 생겨
--  매니저 검토 화면에 중복 표시되고, 하나를 승인해도 다른 하나가 dangling PENDING으로 남는다.
--  부분 unique index로 DB가 두 번째 PENDING 삽입을 거부(P2002) → 라우트가 병합 처리.
--  (enum=enum리터럴 비교는 immutable이라 부분 index 술어로 사용 가능. 비-PENDING 이력행은 제약 없음.
--   enum→text 캐스트는 STABLE이라 술어로 못 씀 → 열거 타입 리터럴로 직접 비교.)
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_edit_requests_one_pending"
  ON "attendance_edit_requests" ("attendance_id")
  WHERE "status" = 'PENDING'::"AttendanceEditReqStatus";
