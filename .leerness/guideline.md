---
leernessRole: guideline
readWhen:
  - 구현 전 품질 기준 확인
  - 계획 이행 기준 확인
updateWhen:
  - 개발 기준 변경
  - 검증 루틴 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Guideline

## Operating Principle
- plan.md의 목표와 범위를 기준으로 작업합니다.
- progress-tracker.md의 요청 상태를 기준으로 완료/미완료를 판단합니다.
- guideline.md에는 진행률 수치를 직접 기록하지 않습니다. 진행률은 plan.md/progress-tracker.md가 단일 출처입니다.

## Quality Gate
- 변경 전 관련 route를 확인합니다 (`leerness route <task-type>`).
- 변경 후 `leerness verify`, `leerness audit`, `leerness check`을 실행합니다.
- 완료 선언 전 `leerness lazy detect`을 실행합니다.
- 세션 종료 시 `leerness session close`를 실행합니다.
