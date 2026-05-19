# 정산해 (Jungsan-hae)

<!-- ───────────────────────────────────────────
     프로덕트 컨텍스트
─────────────────────────────────────────── -->

## 프로젝트 개요
대학 동아리/학과 총무를 위한 정산·신청 관리 웹앱. Cloudflare Pages 정적 배포 (Vite 빌드).

## 스택
- **빌드**: Vite SPA (`vite.config.js` — `@vitejs/plugin-react` + `plugin-legacy`), Node 24 핀(`.nvmrc`)
- **앱 본체**: `src/main.jsx` (~5891줄, React 18 JSX) + `src/calc.js` (정산 순수함수, `3554bb7`로 분리) + `src/calc.test.js` (Vitest, 30 통과)
- **셸**: `index.html` (58줄, `<script type="module" src="/src/main.jsx">` 로드만)
- **npm 의존**: react·react-dom ^18, posthog-js (런타임) / vite ^5·vitest ^4·terser·sharp·플러그인 (빌드)
- **런타임 CDN**: Supabase JS v2, SheetJS 0.20.3 (`<script>`), Pretendard·Material Symbols Rounded (CSS `<link>`)
- **DB**: Supabase (`https://jetxfddjunfpykgyurnf.supabase.co`)
- **배포**: Cloudflare Pages (repo에 호스팅 설정 파일 없음 — CF 대시보드 관리)
- **명령**: `npm run dev`(vite) · `npm run build`(vite build) · `npm test`(vitest run)

## 아키텍처 (7-layer, `src/main.jsx` 5891줄 내부)

⚠️ 레이어 **번호 ≠ 파일 물리 순서**. 파일 순서: 1 → 2 → 3 → 4 → **7 SCREENS** → **5 HOOKS** → **6 SUB COMPONENTS**

```
1. CONFIG        (18~56)    → sb client, ID_DOMAIN(28), C 색상객체(31), SMALL_FLOW(45)/FORM_FLOW(52) 단일소스
2. API LAYER     (57~152)   → 모든 DB/Auth 호출 중앙 관리 (api 객체 62), views 추적
3. UTILITIES     (153~468)  → fmtKRW(216), getLink(226), copyText(229), shareText(253), BANK_CODES(239)/getBankCode(240), matchEngine(320), LEGAL_TEXTS(426)
4. UI PRIMITIVES (469~717)  → Spinner(473)·Icon(526)·Btn(530)·Field·Header·Card·Badge·Toast·SelectGrid·FlowStepper(608)·Modal(630)·ConfirmBulkModal·ExcelPasswordModal + useRealtimeEvent(704)/useRealtimeForm(711)
7. SCREENS       (718~4492) → App(755), AuthScreen(1112), HamburgerMenu(1307), HomeScreen(1348), FeedbackModal(1475), ModeSelectModal(1497), GuideModal(1547), SetupScreen(1578), CreateScreen(1968), AdminEventScreen(2068, 4슬라이드=4스텝), AttendanceSection(2197), FeeConfigSection(2286), RoundsSection(2426), ShareSection(2959), StatusSection(3026), NotFound/ParticipantSplash(3519/3534), ParticipantScreen(3558), HelpScreen(3801), UsageGuideScreen(3869), HistoryScreen(3907), OnboardingModal(4042), SmallEventOnboardingModal(4080), FormOnboardingModal(4127), FormCreateScreen(4173)
5. HOOKS         (4493~4616)→ useFormAdmin(4497) + PaySegCtrl(4594, 컴포넌트지만 이 섹션에 위치)
6. SUB COMPONENTS(4617~5891)→ MemberDetailModal(4621), SubmissionsTab(4650), VerifyTab(4884), FormShareTab(4932), FormShareModal(4980), PasteFeeModal(4988), DunningModal(5082), CloseFormModal(5146), BridgeNameModal(5158) + FormAdminScreen(5173)/FormSubmitScreen(5487)
```

### Layer 구분 원칙
- **Layer 5 (HOOKS)**: 화면 로직만, JSX 없음. 상태·핸들러 묶음을 반환
- **Layer 6 (SUB COMPONENTS)**: 특정 Screen에서 분리된 탭/모달. 단독 라우팅 없음
- **Layer 7 (SCREENS)**: 라우팅 가능한 최상위 화면. Hook + SubComponent를 조합만 함

### 구조 caveat (청크 작업 시 위치 주의)
- realtime hook(`useRealtimeEvent`/`useRealtimeForm`)은 Layer 5가 아니라 **Layer 4 끝(704·711)**
- `PaySegCtrl`(컴포넌트)은 Layer 5 HOOKS 섹션(4594)에 위치
- `FormAdminScreen`(5173)·`FormSubmitScreen`(5487)은 라우팅 SCREEN이나 **Layer 6 섹션** 안에 위치
- `BANK_CODES`/`LEGAL_TEXTS`는 CONFIG가 아니라 **Layer 3 UTILITIES**

## 최근 구조 변경 (히스토리)
- **calc.js 분리** (`3554bb7`): 정산 순수함수(getUserAmount, calcAmounts, getPayStatus, roundFeeAmounts 등)를 `src/calc.js`로 분리 → Vitest 단위테스트 가능
- **AdminEvent 4슬라이드**: 정산 진행 = 출석/금액/공유/대조 4슬라이드 = 4스텝 1:1, RoundsSection 단일 인스턴스 상주
- **디자인 토큰**: `index.html` `:root`에 토큰(`--bg-page`/`--border`/`--text-strong` 등). 토큰화된 화면만 `var(--*)`, 나머지는 `C` 객체 — 점진 전환 중
- **단일소스 흐름 상수**: `SMALL_FLOW`/`FORM_FLOW`(L45/52) — 온보딩 모달·진행 스텝퍼·사용방법 화면이 공유

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
- 런타임 의존은 CDN 유지 — vite/vitest 등 빌드 의존 외 런타임 npm 패키지 추가 지양
- Supabase 스키마 변경 시 기존 저장 데이터 호환성 체크 필수
- 인증 관련 코드(Supabase Auth)는 명시 요청 없이 수정 금지

## 코딩 컨벤션
- **Vite 다중 파일 구조**: `src/main.jsx`(앱) + `src/calc.js`(순수함수). 정적 배포(CF Pages) 유지, 런타임 의존은 CDN
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
