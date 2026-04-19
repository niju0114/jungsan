# 정산해 (Jungsan-hae)

## 프로젝트 개요
대학 동아리/학과 총무를 위한 정산·신청 관리 웹앱. Netlify 정적 배포.

## 스택
- **단일 파일**: `index.html` (~3200줄, React 18 + Babel + Supabase JS CDN)
- **DB**: Supabase (`https://jetxfddjunfpykgyurnf.supabase.co`)
- **배포**: Netlify 정적 호스팅
- **CDN**: React 18, ReactDOM, Babel Standalone, Supabase JS, SheetJS (XLSX)

## 아키텍처 (7-layer, 단일 파일 내부)
```
1. CONFIG (51~70)          → Supabase 설정, 색상(C), ID_DOMAIN, BANK_CODES, LEGAL_TEXTS
2. API LAYER (71~140)      → 모든 DB/Auth 호출 중앙 관리 (api 객체), views 추적
3. UTILITIES (141~363)     → 순수 함수 (변환, 포맷, matchEngine, 딥링크, copyText, shareText)
4. UI PRIMITIVES (364~461) → Spinner, Btn, Field, Header, Card, Badge, Toast, SelectGrid
5. HOOKS (2467~)           → useFormAdmin (FormAdmin 전용 로직 분리)
6. SUB COMPONENTS (1062~)  → FeedbackModal, ModeSelectModal, SubmissionsTab, VerifyTab, FormShareTab
7. SCREENS (462~)          → App, Landing, Auth, Home, Setup, Create, AdminEvent, FormCreate, FormAdmin, FormSubmit, History, Guide, Onboarding
```

### Layer 구분 원칙
- **Layer 5 (HOOKS)**: 화면 로직만, JSX 없음. 상태·핸들러 묶음을 반환
- **Layer 6 (SUB COMPONENTS)**: 특정 Screen에서 분리된 탭/모달. 단독 라우팅 없음
- **Layer 7 (SCREENS)**: 라우팅 가능한 최상위 화면. Hook + SubComponent를 조합만 함

## Supabase 테이블
- `events` — 소규모 정산 (code, name, date, members, rounds, payments, attendance 등)
- `profiles` — 사용자 프로필 (account, groups, name, school 등)
- `forms` — 대규모 신청폼 (code, name, submissions jsonb, fields 등)
- `views` — 조회수 추적 (event_code, form_code, viewer_key, viewed_at)

## 핵심 규칙
- **단일 HTML 유지**: Netlify 정적 배포 제약. 파일 분리하지 않음 (레이어 분리는 파일 내 논리적 구조로만)
- **새 로직은 Hook에**: 화면 로직 추가 시 Screen 비대화 방지를 위해 useXxx Hook으로 분리
- **새 탭/모달은 Sub Component에**: 100줄 이상 탭은 별도 컴포넌트로 추출 후 Screen에서 호출
- **sb.from() 직접 호출 금지**: 반드시 api 객체를 통해서만 DB 접근
- **한국어 UI**: 모든 사용자 노출 텍스트는 한국어
- **모바일 퍼스트**: 토스 UX 패턴, 480px max-width
- **Supabase anon key는 클라이언트 전용**: RLS로 보호됨, 노출 OK

## 주요 기능
### 소규모 (술자리·뒷풀이)
- 명단 그룹 관리 → 출석 체크 → 차수별 금액 → OX 보드 → 카톡 공유
- 토스/카뱅 송금 딥링크
- 콕 찌르기 (미입금자 메시지)

### 대규모 (행사·야식마차)
- 신청폼 생성 (기본: 이름/연락처/학년/학번 + 커스텀 필드)
- 선착순 마감, 중복 신청 방지 (이름+전화번호)
- 재방문 시 상태 확인 (localStorage)
- 3단계 입금: 대기→요청됨→확정
- 은행 거래내역 엑셀 자동 대조 (matchEngine)
- 신청자 ↔ 명단 그룹 자동 매칭
- 신청 명단 → 프로필 명단 저장

## 코드 수정 시 주의사항
- str_replace 후 반드시 괄호 균형 체크 (Braces, Parens, Brackets)
- `C` 객체에서 색상 참조 (하드코딩 금지)
- `copyText()` 유틸 사용 (navigator.clipboard 직접 호출 금지)
- `getLink()` 유틸 사용 (URL 직접 조합 금지)
- `matchEngine` 순수 함수 사용 (FormAdminScreen에서 중복 로직 금지)

## 참여자 화면 URL 파라미터
- `?code=ABC123` → 소규모 참여자 화면
- `?code=ABC123&k=홍길동` → 소규모 개인 링크 (이름 자동 선택)
- `?form=ABC123` → 대규모 신청폼

## 나중에 할 것 (지금 안 함)
- 이메일 자동화 (jungsan.app 도메인 이메일 수신 → 자동 파싱)
- 푸시 알림 (Edge Function + FCM, 5명 단위)
- submissions 테이블 분리 (jsonb → 별도 테이블)
- analytics 테이블 + PostHog 연동
- 정산 요약 복사 기능
