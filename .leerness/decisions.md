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
