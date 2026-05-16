-- ============================================================
-- 정산해: 참여자 플로우 보안/레이스 수정
-- Supabase Dashboard > SQL Editor 에서 실행 (기존 RPC 덮어씀)
-- 적용 순서: rls_participant_functions.sql + add_mark_event_requested.sql 이후
-- ============================================================

-- 1. append_form_submission: 행 잠금(FOR UPDATE)으로 정원 레이스 차단 +
--    서버측 중복 신청 차단 (이름+전화 / 폰 없으면 이름+학번)
CREATE OR REPLACE FUNCTION append_form_submission(p_code text, p_submission jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_form record;
  v_name text := trim(p_submission->>'name');
  v_phone text := NULLIF(regexp_replace(COALESCE(p_submission->>'phone',''),'[^0-9]','','g'),'');
  v_sid text := NULLIF(regexp_replace(COALESCE(p_submission->'data'->>'studentId',''),'\s','','g'),'');
BEGIN
  -- 행 잠금: 동시 제출 직렬화 (선착순 정원 초과 방지)
  SELECT * INTO v_form FROM public.forms WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;
  IF v_form.status != 'open' THEN RETURN jsonb_build_object('error','closed'); END IF;
  IF v_form.max_people IS NOT NULL AND
     jsonb_array_length(COALESCE(v_form.submissions,'[]'::jsonb)) >= v_form.max_people
    THEN RETURN jsonb_build_object('error','full'); END IF;

  -- 서버측 중복 차단 (localStorage 우회/멀티기기/레이스 대비)
  IF v_name <> '' AND (v_phone IS NOT NULL OR v_sid IS NOT NULL) THEN
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(v_form.submissions,'[]'::jsonb)) e
      WHERE trim(e->>'name') = v_name
        AND (
          ( v_phone IS NOT NULL
            AND regexp_replace(COALESCE(e->>'phone',''),'[^0-9]','','g') = v_phone )
          OR
          ( v_phone IS NULL AND v_sid IS NOT NULL
            AND regexp_replace(COALESCE(e->'data'->>'studentId',''),'\s','','g') = v_sid )
        )
    ) THEN
      RETURN jsonb_build_object('error','duplicate');
    END IF;
  END IF;

  UPDATE public.forms
  SET submissions = COALESCE(submissions,'[]'::jsonb) || jsonb_build_array(p_submission)
  WHERE code = p_code;
  RETURN jsonb_build_object('ok',true);
END;
$$;
GRANT EXECUTE ON FUNCTION append_form_submission TO anon;

-- 2. mark_event_attendance: 멤버 키 검증 (임의 키 JSON 주입 차단)
CREATE OR REPLACE FUNCTION mark_event_attendance(p_code text, p_member_key text, p_present boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_members jsonb;
BEGIN
  SELECT COALESCE(members,'[]'::jsonb) INTO v_members FROM public.events WHERE code = p_code;
  IF v_members IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v_members) m WHERE m = p_member_key
  ) THEN RETURN; END IF;
  UPDATE public.events
  SET attendance = jsonb_set(COALESCE(attendance,'{}'), ARRAY[p_member_key], to_jsonb(p_present))
  WHERE code = p_code;
END;
$$;
GRANT EXECUTE ON FUNCTION mark_event_attendance TO anon;

-- 3. mark_event_requested: 멤버 키 검증 추가
CREATE OR REPLACE FUNCTION mark_event_requested(p_code text, p_member_key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_members jsonb;
BEGIN
  SELECT COALESCE(members,'[]'::jsonb) INTO v_members FROM public.events WHERE code = p_code;
  IF v_members IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v_members) m WHERE m = p_member_key
  ) THEN RETURN; END IF;
  UPDATE public.events
  SET payments = jsonb_set(
    COALESCE(payments,'{}'),
    ARRAY[p_member_key],
    COALESCE(payments->p_member_key,'{}') || jsonb_build_object(
      'requested', true,
      'payStatus', 'requested',
      'requestedAt', to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  )
  WHERE code = p_code;
END;
$$;
GRANT EXECUTE ON FUNCTION mark_event_requested TO anon;

-- 4. mark_event_paid: 클라이언트 미사용 RPC — anon 실행 권한 회수
--    (참여자가 임의로 입금완료 위조하던 경로 차단. 총무는 오너 RLS로 직접 UPDATE)
REVOKE EXECUTE ON FUNCTION mark_event_paid(text, text, boolean) FROM anon;

-- 5. (선택) 코드 유일성 보장 — 기존 중복 데이터 없을 때만 성공.
--    실패하면 중복 코드부터 수동 정리 후 주석 해제하여 실행.
-- ALTER TABLE public.events ADD CONSTRAINT events_code_key UNIQUE (code);
-- ALTER TABLE public.forms  ADD CONSTRAINT forms_code_key  UNIQUE (code);
