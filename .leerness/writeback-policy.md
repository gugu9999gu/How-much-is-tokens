---
leernessRole: writeback-policy
readWhen:
  - 작업 완료 전
  - 문서 갱신 판단
updateWhen:
  - 기록 대상 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Writeback Policy

- plan.md: 사용자 목적, milestone, 범위 추가/제외
- progress-tracker.md: 요청 단위 상태와 증거 (in-place 갱신)
- current-state.md: 현재 상태와 다음 작업
- task-log.md: 수행 이력 (자동 추가)
- session-handoff.md: 다음 세션 인수인계 (`session close`가 자동 작성)
- decisions.md: 되돌리기 어려운 결정
- design-system.md: UI/UX/컴포넌트 기준
- feature-contracts.md: 입력/출력/상태/오류 계약
- review-evidence.md: 검증 결과 (자동 누적)
