-- ============================================
-- 정산해: views (조회수 추적) 테이블
-- Supabase Dashboard > SQL Editor 에서 실행
-- ============================================

CREATE TABLE public.views (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_code text,
  form_code text,
  viewer_key text,
  viewed_at timestamptz DEFAULT now()
);

CREATE INDEX idx_views_event ON public.views(event_code);
CREATE INDEX idx_views_form ON public.views(form_code);

ALTER TABLE public.views ENABLE ROW LEVEL SECURITY;

-- 누구나 INSERT 가능 (참여자가 비로그인 상태에서도)
CREATE POLICY "views_insert_all" ON public.views FOR INSERT WITH CHECK (true);
-- 로그인 사용자만 조회 (총무가 관리화면에서)
CREATE POLICY "views_select_auth" ON public.views FOR SELECT USING (auth.uid() IS NOT NULL);
