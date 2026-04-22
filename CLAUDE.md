# 정산해 (Jungsan-hae)

<!-- ───────────────────────────────────────────
     프로덕트 컨텍스트
─────────────────────────────────────────── -->

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
5. HOOKS (2859~)           → useFormAdmin (FormAdmin 전용 로직 분리)
6. SUB COMPONENTS (2966~)  → SubmissionsTab, VerifyTab, FormShareTab
7. SCREENS (520~)          → App, Landing, Auth, Home, Setup, Create, AdminEvent, FormCreate, FormAdmin, FormSubmit, History, Guide, Onboarding, FeedbackModal, ModeSelectModal, GuideModal, OnboardingModal
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

## 참여자 화면 URL 파라미터
- `?code=ABC123` → 소규모 참여자 화면
- `?code=ABC123&k=홍길동` → 소규모 개인 링크 (이름 자동 선택)
- `?form=ABC123` → 대규모 신청폼

<!-- ───────────────────────────────────────────
     작업 규칙
─────────────────────────────────────────── -->

## 제품 제약
- **한국어 UI**: 모든 사용자 노출 텍스트는 한국어
- **모바일 퍼스트**: 토스 UX 패턴, 480px max-width
- **Supabase anon key는 클라이언트 전용**: RLS로 보호됨, 노출 OK

## 작업 플로우
- 코드 수정 전에 항상 변경 계획(영향 파일/함수, 접근 방식)을 먼저 제시하고 유저 승인 후 구현 시작
- 스키마/데이터 구조 변경 시: 영향 범위를 전수조사해서 목록 보고 후 진행
- 한 작업 안에서 요청 범위 밖의 리팩토링 금지 ("겸사겸사" 금지)
- DB 마이그레이션이 필요하면 마이그레이션 SQL을 별도 제공

## 절대 금지 사항
- `sb.from()` 직접 호출 금지 — 반드시 `api` 객체를 통해서만 DB 접근
- 정산 계산 로직은 명시 요청 없이 수정 금지
- 새 npm 패키지 추가 금지 (CDN 단일 HTML 구조 유지)
- Supabase 스키마 변경 시 기존 저장 데이터 호환성 체크 필수
- 인증 관련 코드(Supabase Auth)는 명시 요청 없이 수정 금지

## 코딩 컨벤션
- **단일 HTML 유지**: Netlify 정적 배포 제약, 파일 분리하지 않음
- **새 Hook은 Layer 5(HOOKS)에 추가, 새 Sub Component는 Layer 6(SUB COMPONENTS)에 추가** — 7-layer 구조 유지
- str_replace 후 반드시 괄호 균형 체크 (Braces, Parens, Brackets)
- `C` 객체에서 색상 참조 (하드코딩 금지)
- `copyText()` 유틸 사용 (navigator.clipboard 직접 호출 금지)
- `getLink()` 유틸 사용 (URL 직접 조합 금지)
- `matchEngine` 순수 함수 사용 (FormAdminScreen에서 중복 로직 금지)
- 주석 최소화: 코드로 표현 가능하면 주석 불필요, 이유(why)만 주석으로
- 변수명/함수명은 영문, 사용자 노출 텍스트만 한국어
- DB 필드명 한글화 결정은 별도 합의 전까지 현행 유지

## 리그레션 체크 시나리오
변경 후 아래 5개 플로우를 수동 테스트 권장:
1. 소규모: 명단 생성 → 출석 체크 → 차수별 금액 입력 → OX 보드 → 카톡 공유
2. 대규모: 신청폼 생성 → 제출 → 중복 방지 확인 → 관리자 화면 확인
3. 엑셀 거래내역 업로드 → matchEngine 대조 → 미입금자 표시
4. 토스/카뱅 딥링크 정상 동작
5. 기존 저장된 이벤트/폼 불러오기 정상

## 완료 리포트 포맷
작업 완료 시 아래 형식으로 보고:
- 변경 파일 및 라인 범위
- 주요 변경사항 (3줄 이내 요약)
- 영향받은 레이어
- 수동 테스트 권장 시나리오 (위 5개 중 관련 항목 지정)
- 알려진 side effect 또는 후속 작업 필요 항목

<!-- ───────────────────────────────────────────
     백로그
─────────────────────────────────────────── -->

## 나중에 할 것 (지금 안 함)
- 이메일 자동화 (jungsan.app 도메인 이메일 수신 → 자동 파싱)
- 푸시 알림 (Edge Function + FCM, 5명 단위)
- submissions 테이블 분리 (jsonb → 별도 테이블)
- analytics 테이블 + PostHog 연동
- 정산 요약 복사 기능
