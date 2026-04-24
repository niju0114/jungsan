-- 파트 B: 정산 방식 설정 (자동 계산 / 직접 입력)
-- fee_config 구조: {mode, totalCost, subsidyPerPaid, paidFeeAmount, unpaidFeeAmount}
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS fee_config jsonb;

-- 파트 C: 멤버별 학생회비 납부 여부
-- member_meta 구조: {[memberKey]: {paidFee: boolean}}
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS member_meta jsonb;

-- 파트 A: 신청폼 → 정산 브리지 역추적용
-- 양방향 링크 후속 청크를 위해 저장만 해둠
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS source_form_code text;
