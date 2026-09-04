---
leernessRole: plan-progress-boundary
readWhen:
  - 계획과 진행률이 중복될 때
  - 작업 추적 구조 변경
updateWhen:
  - 역할 분리 기준 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Plan / Progress Boundary

## plan.md
- 전체 목표, milestone, 포함/제외 범위, 계획 변경 이력.

## progress-tracker.md
- 사용자 요청 단위의 상태, 증거, 다음 액션.
- ID 규칙: T-0001부터 단조 증가. plan add 시 부여되는 ID는 plan/progress 양쪽에서 고유합니다.

## guideline.md
- plan/progress를 수행할 때 지켜야 할 실행 기준.
