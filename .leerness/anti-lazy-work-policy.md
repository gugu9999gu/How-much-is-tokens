---
leernessRole: anti-lazy-work-policy
readWhen:
  - 완료 선언 전
updateWhen:
  - 게으른 작업 방지 기준 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Anti Lazy Work Policy

## Rules
1. **증거 없는 완료 금지**: "완료"를 선언하려면 progress-tracker의 evidence 컬럼에 명령 출력/테스트 결과/스크린샷 경로 등이 있어야 합니다.
2. **빈 핸드오프 금지**: 세션 종료 시 session-handoff.md의 Completed/In Progress/Next Exact Step이 모두 비어 있으면 close가 "insufficient" 상태로 표시됩니다.
3. **부분 구현 자기보고**: 완전 구현이 아니면 status를 `incomplete`로, Next Exact Step에 "무엇을 추가해야 끝나는지" 한 줄을 적습니다.
4. **검증 기록**: typecheck/lint/test 결과를 review-evidence.md에 누적 기록합니다.
5. **TODO 표지**: 코드에 `TODO`/`FIXME`/`XXX`를 새로 도입하면 progress-tracker에 동일 ID로 추적합니다.
6. **거짓 완료 자동 감지**: `leerness lazy detect`는 다음을 자동 점검합니다.
   - progress-tracker에 done인데 evidence가 비어있는 row
   - session-handoff의 Completed가 비어있고 Next Exact Step도 비어있음
   - 코드에 새 TODO/FIXME 추가 + progress-tracker에 추적 항목 없음
   - test 명령 실행 흔적 없음 (review-evidence.md 또는 task-log.md에 명령 기록)
7. **품질 렌즈 자가질문**: 완료 선언 전 `leerness lens`의 분야별 질문에 스스로 답합니다 — 코드: "선임 개발자가 이 코드를 보고 복잡하다고 느끼지 않을까?" / 디자인: "선임 디자이너와 일반 사용자가 봤을 때 이쁘고 편하고 직관적인가?". "그렇다(통과)"라고 답할 수 없으면 완료가 아닙니다. 분야를 바꾸면 인과관계로 연결된 분야(`lens` 출력의 ↔ 인과)의 질문도 다시 확인합니다.
