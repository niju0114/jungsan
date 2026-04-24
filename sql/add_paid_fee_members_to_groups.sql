-- profiles.groups JSONB 배열 내 각 그룹 객체에 paidFeeMembers 필드 추가
-- ALTER TABLE 불필요 (JSONB 컬럼은 이미 존재)
--
-- 그룹 객체 구조 (변경 후):
-- {
--   id: string,
--   name: string,
--   rawText: string,
--   members: [{name: string, sid: string}],
--   paidFeeMembers: string[]   ← 추가 (멤버 key 배열: "이름_학번" 또는 "이름")
-- }
--
-- paidFeeMembers 미포함 기존 그룹은 ||[] fallback으로 호환 유지.
--
-- 전체 초기화가 필요한 경우 아래 쿼리로 기존 데이터에 빈 배열 추가:
UPDATE public.profiles
SET groups = (
  SELECT jsonb_agg(
    CASE
      WHEN g ? 'paidFeeMembers' THEN g
      ELSE g || '{"paidFeeMembers": []}'::jsonb
    END
  )
  FROM jsonb_array_elements(groups) AS g
)
WHERE groups IS NOT NULL
  AND jsonb_typeof(groups) = 'array';
