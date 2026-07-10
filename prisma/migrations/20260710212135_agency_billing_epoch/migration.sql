-- 수동 구독 결제 orderId의 '이벤트 키'. 해지 때마다 +1 → 재구독은 새 orderId(실결제),
--  DB반영 실패 후 재시도는 epoch 불변 → 같은 orderId(Toss 멱등 복구).
--  시간(월/일) 기준 orderId의 이중청구↔무료사이클 딜레마를 근본 제거.
ALTER TABLE "agencies" ADD COLUMN "billing_epoch" INTEGER NOT NULL DEFAULT 0;
