---
leernessRole: decisions
readWhen:
  - 설계 결정 확인
updateWhen:
  - 중요 결정 발생
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Decisions

## Template (예시 — 실제 결정은 아래 코드블록 밖에 추가)

```md
### 2026-09-04 — Decision 제목
- Decision:
- Reason:
- Alternatives:
- Impact:
```

### 2026-09-23 — 한도·리셋 쿠폰·CLI 버전·결제 주기 표시
- Decision: Claude 세션 한도는 `5시간 한도`로 표시한다. Claude 리셋 쿠폰은 OAuth usage의 `cedar_ember`/`juniper_tide`를 읽기 전용으로 조회하고, `ineligible_reason: surface`이면 수량을 만들지 않고 웹 전용으로 표시한다. Codex 리셋 쿠폰 수량은 wham usage의 `available_count`를 우선하고, 만료일은 `GET /wham/rate-limit-reset-credits`가 성공할 때만 붙인다. 쿠폰 소비 API는 호출하지 않는다. 결제일은 공급자가 준 billing cycle 또는 갱신 시각만 표시하고, 다음 청구일이 없으면 구독 시작일 또는 정보 없음으로 표시한다. 설치된 CLI 버전과 업데이트 가능 여부는 사용량 카드에 표시한다.
- Reason: 위젯이 이미 갖고 있는 한도·쿠폰 데이터가 카드에서 빠지거나 다른 이름으로 보여, 사용자가 5시간 한도, 쿠폰 잔여, 설치 버전, 결제일을 한 화면에서 볼 수 없었다.
- Alternatives: 구독 시작일로 다음 결제일을 월간 추정한다 — 연간 구독에서 거짓 날짜가 되므로 하지 않음. Claude 웹 쿠키로 쿠폰 수량을 읽는다 — 기존 OAuth 자격증명 경계를 넓히므로 하지 않음.
- Impact: provider payload의 `billing`/`resetCoupons`, 사용량 카드 사실 행, CLI 버전 스탬프. 공개 배포는 `gugu9999gu/How-much-is-tokens-releases`의 바이너리만 사용한다.

### 2026-09-23 — 이 PC 자격증명으로 확인한 결제일 범위
- Decision: 결제일은 로그인한 CLI/OAuth가 실제로 주는 값만 표시한다. Cursor·Grok Bot은 billing cycle, Copilot은 할당 갱신일, Grok은 이용 기간, ElevenLabs는 다음 갱신일, Claude는 구독 상태와 구독 시작일만 보여 준다. Codex CLI 토큰의 구독/결제 API는 403이라 결제일을 만들지 않는다. Antigravity `agy -p /usage`는 5시간·주간 한도 갱신 시각만 주고 결제일은 없다. 카드는 쿠폰·결제·CLI를 한 줄 알약이 아니라 칸으로 구분한다.
- Reason: v1.0.34는 날짜가 없으면 "결제일 정보 없음"을 모든 카드에 같은 알약으로 붙여, 조회 가능한 날짜와 불가능한 날짜가 구분되지 않았다.
- Alternatives: 구독 시작일로 다음 결제일을 월 단위 추정한다 — 연간 구독에서 거짓이므로 하지 않음. 브라우저 쿠키로 Claude/Codex 결제 페이지를 읽는다 — 기존 CLI 자격증명 밖이라 하지 않음.
- Impact: 카드 메타 칸, Claude planLabel, agy usage 타임아웃 25초, Windows에서 Codex 실행 파일은 `.exe`/`.cmd`를 우선 선택.

### 2026-09-23 — 결제일이 없으면 주간·월간 한도 갱신일을 표시
- Decision: 결제 주기 시각이 없는 플랫폼은 5시간 창을 결제일로 쓰지 않고, 주간 또는 월간 한도 중 가장 빠른 갱신 시각을 `한도 갱신`으로 표시한다. 구독 시작일로 다음 청구일을 계산하지 않는다.
- Reason: 이 PC 조회에서 Claude는 주간 한도 갱신, Codex는 7일 창 갱신, Antigravity는 주간 한도 갱신만 있었고 결제일은 없었다. Cursor와 Grok은 기존 결제·이용 기간을 유지한다.
- Alternatives: 5시간 리셋 시각을 마지막 사용일로 표시 — 세션 창이라 플랜 갱신이 아님. 구독 시작일의 매월 같은 날을 결제일로 추정 — 연간 구독에서 거짓.
- Impact: `accessRenewal`과 카드의 한도 갱신 칸.

### 2026-09-27 — Claude 사용량은 액세스 토큰이 만료돼도 재로그인 없이 갱신
- Decision: Claude 사용량 조회는 `.credentials.json`의 `claudeAiOauth`가 만료됐거나 5분 이내면 `POST https://platform.claude.com/v1/oauth/token`으로 갱신한 뒤 조회한다. 요청에는 저장된 scope를 포함한다. 갱신에 성공하면 새 access/refresh와 만료 시각만 기록하고 `mcpOAuth` 등 다른 키는 유지한다. `invalid_grant`나 네트워크 실패로는 refresh token을 지우지 않는다. 429는 2분, 그 외 실패는 30초 동안 다시 치지 않고 마지막 사용량을 유지한다. 리프레시 토큰 자체도 만료됐으면 로그인으로 표시한다. 쿠폰 소비 요청은 하지 않는다.
- Reason: 액세스 토큰은 약 8시간(`expires_in` 28800)이면 만료되는데 위젯은 만료된 토큰만 읽어, 몇 시간 뒤 사용량 추적이 끊기고 `claude` 재로그인이 필요했다.
- Alternatives: 만료 시 카드만 숨기거나 캐시만 보여 준다 — 수치는 멈추고 다음 조회가 안 된다. 브라우저 쿠키로 사용량을 읽는다 — 기존 CLI 자격증명 밖으로 범위를 넓히므로 하지 않음.
- Impact: `lib/providers/claude.js` 조회 경로. 공개 릴리스는 아직 아니다.
