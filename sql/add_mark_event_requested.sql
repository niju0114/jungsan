-- mark_event_requested: 참여자가 계좌 복사/딥링크 클릭 시 호출
-- payStatus 신규 필드 + requested 레거시 필드 동시 세팅 (하위 호환)
-- Supabase Dashboard > SQL Editor 에서 실행
CREATE OR REPLACE FUNCTION mark_event_requested(p_code text, p_member_key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
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
