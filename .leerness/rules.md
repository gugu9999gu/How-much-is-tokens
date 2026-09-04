---
leernessRole: rules
readWhen:
  - 세션 시작 (handoff)
  - 매 작업 시작 전
  - 매 작업 완료 전
  - 세션 종료 시 (session close)
updateWhen:
  - 사용자가 자연어로 새 룰 요청
  - 사용자가 룰 중지/제거 요청
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# User Rules

매 세션·매 작업마다 AI 에이전트가 반드시 따라야 할 사용자 정의 영구 룰.
사용자가 명시적으로 "중지" / "제거"를 요청하기 전까지 모든 active 룰을 매 세션 자동 노출/검증합니다.

## Active Rules

| ID | Trigger | Rule | Added | Status | Last Verified |
|---|---|---|---|---|---|
