-- ============================================================
-- 정산해: 참여자 전용 DB 함수 + RLS 강화
-- Supabase Dashboard > SQL Editor 에서 실행
-- ============================================================

-- 1. 참여자 출석 업데이트 (attendance 필드만)
CREATE OR REPLACE FUNCTION mark_event_attendance(p_code text, p_member_key text, p_present boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.events
  SET attendance = jsonb_set(COALESCE(attendance,'{}'), ARRAY[p_member_key], to_jsonb(p_present))
  WHERE code = p_code;
END;
$$;
GRANT EXECUTE ON FUNCTION mark_event_attendance TO anon;

-- 2. 참여자 입금 상태 업데이트 (payments 필드만)
CREATE OR REPLACE FUNCTION mark_event_paid(p_code text, p_member_key text, p_paid boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.events
  SET payments = jsonb_set(
    COALESCE(payments,'{}'),
    ARRAY[p_member_key],
    CASE WHEN p_paid
      THEN jsonb_build_object('paid',true,'time',to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'by','self')
      ELSE jsonb_build_object('paid',false,'time',NULL,'by',NULL)
    END
  )
  WHERE code = p_code;
END;
$$;
GRANT EXECUTE ON FUNCTION mark_event_paid TO anon;

-- 3. 참여자 신청 추가 (submissions append만, 마감/정원 서버 검증 포함)
CREATE OR REPLACE FUNCTION append_form_submission(p_code text, p_submission jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_form record;
BEGIN
  SELECT * INTO v_form FROM public.forms WHERE code = p_code;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;
  IF v_form.status != 'open' THEN RETURN jsonb_build_object('error','closed'); END IF;
  IF v_form.max_people IS NOT NULL AND
     jsonb_array_length(COALESCE(v_form.submissions,'[]'::jsonb)) >= v_form.max_people
    THEN RETURN jsonb_build_object('error','full'); END IF;
  UPDATE public.forms
  SET submissions = COALESCE(submissions,'[]'::jsonb) || jsonb_build_array(p_submission)
  WHERE code = p_code;
  RETURN jsonb_build_object('ok',true);
END;
$$;
GRANT EXECUTE ON FUNCTION append_form_submission TO anon;

-- 4. 참여자 입금 완료 요청 (paymentStatus 필드만)
CREATE OR REPLACE FUNCTION request_form_payment(p_code text, p_created_at text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_idx int;
BEGIN
  SELECT (pos-1) INTO v_idx
  FROM public.forms, jsonb_array_elements(submissions) WITH ORDINALITY arr(elem,pos)
  WHERE code = p_code AND elem->>'createdAt' = p_created_at
  LIMIT 1;
  IF v_idx IS NOT NULL THEN
    UPDATE public.forms
    SET submissions = jsonb_set(
      submissions, ARRAY[v_idx::text],
      (submissions->v_idx) || jsonb_build_object(
        'paymentStatus','requested',
        'requestedAt',to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    )
    WHERE code = p_code;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION request_form_payment TO anon;

-- 5. events RLS: 소유자만 전체 업데이트 (참여자는 함수 경유)
DROP POLICY IF EXISTS "events_update_all" ON public.events;
CREATE POLICY "events_update_own"
  ON public.events FOR UPDATE
  USING (auth.uid() = user_id);

-- 6. forms RLS: 소유자만 전체 업데이트 (참여자는 함수 경유)
DROP POLICY IF EXISTS "forms_update_all" ON public.forms;
CREATE POLICY "forms_update_own"
  ON public.forms FOR UPDATE
  USING (auth.uid() = user_id);
