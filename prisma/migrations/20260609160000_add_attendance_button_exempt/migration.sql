-- 출퇴근 버튼 면제(시프티 병행): 매일 자동 출근부 생성 + 실제 버튼시각 무시(지각·이슈 미발생).
ALTER TABLE "site_assignments" ADD COLUMN "attendance_button_exempt" BOOLEAN NOT NULL DEFAULT false;
