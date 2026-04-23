-- ============================================
-- 정산해: forms 테이블에 time/place/extra_message 컬럼 추가
-- Supabase Dashboard > SQL Editor 에서 실행
-- ============================================

ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS time text;
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS place text;
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS extra_message text;
