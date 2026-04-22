# SQL 스크립트

Supabase Dashboard > SQL Editor에서 아래 순서로 실행.

## 파일 목록

| 파일 | 설명 |
|------|------|
| `create_forms_table.sql` | forms 테이블 생성 + 기본 RLS 정책 |
| `create_views_table.sql` | views 조회수 추적 테이블 생성 + RLS |
| `rls_participant_functions.sql` | 참여자 전용 RPC 4개 + events/forms 오너 RLS 강화 |

## 적용 순서

1. `create_forms_table.sql`
2. `create_views_table.sql`
3. `rls_participant_functions.sql`

## 참고

RPC 함수가 `SECURITY DEFINER`인 이유: 비로그인 참여자(anon)가 자신의 출석·입금 필드만 업데이트할 수 있도록, DB 소유자 권한으로 실행하되 함수 내부에서 지정 필드만 수정하도록 제한.
