---
leernessRole: consistency-policy
readWhen:
  - UI/기능 중복 생성 전
  - 재사용 판단
updateWhen:
  - 일관성 정책 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Consistency Policy

동일한 기능을 하는 요소는 새로 만들기 전에 기존 구현을 찾아 재사용/확장/연결합니다.

## Recursive Reuse Rule
1. 같은 기능의 기존 요소를 찾습니다.
2. 자기 참조/기저 규칙/재귀 흐름이 필요한지 확인합니다.
3. 기존 요소를 재사용하거나 확장합니다.
4. 불가피하게 새로 만들면 reuse-map.md에 이유를 기록합니다.

## Audit Trigger
`leerness audit`는 다음을 검사합니다:
- 디자인 가이드 중복 파일
- design-system.md 토큰 미정의
- reuse-map.md 비어있음 + 컴포넌트/유틸 ≥3개 발견
- plan vs progress 정렬
