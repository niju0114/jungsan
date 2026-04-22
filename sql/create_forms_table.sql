-- ============================================
-- 정산해: forms 테이블 생성 SQL
-- Supabase Dashboard > SQL Editor 에서 실행
-- ============================================

-- 1) 테이블 생성
CREATE TABLE public.forms (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text UNIQUE NOT NULL,
  name        text NOT NULL,
  date        text,
  amount      numeric DEFAULT 0,
  max_people  integer,
  account     jsonb DEFAULT '{}'::jsonb,
  fields      jsonb DEFAULT '[]'::jsonb,
  submissions jsonb DEFAULT '[]'::jsonb,
  status      text DEFAULT 'open',
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now()
);

-- 2) 인덱스
CREATE INDEX idx_forms_code ON public.forms(code);
CREATE INDEX idx_forms_user_id ON public.forms(user_id);

-- 3) RLS (Row Level Security) 활성화
ALTER TABLE public.forms ENABLE ROW LEVEL SECURITY;

-- 4) RLS 정책: 누구나 code로 조회 가능 (참여자 접근용)
CREATE POLICY "forms_select_by_code"
  ON public.forms FOR SELECT
  USING (true);

-- 5) RLS 정책: 본인 폼만 생성
CREATE POLICY "forms_insert_own"
  ON public.forms FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 6) RLS 정책: 누구나 업데이트 가능 (참여자 submission 추가용)
CREATE POLICY "forms_update_all"
  ON public.forms FOR UPDATE
  USING (true);

-- 7) RLS 정책: 본인 폼만 삭제
CREATE POLICY "forms_delete_own"
  ON public.forms FOR DELETE
  USING (auth.uid() = user_id);

-- 8) Realtime 활성화 (선택)
ALTER PUBLICATION supabase_realtime ADD TABLE public.forms;
