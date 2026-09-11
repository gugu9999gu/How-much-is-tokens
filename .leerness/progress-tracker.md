---
leernessRole: progress-tracker
readWhen:
  - 세션 시작
  - 세션 종료
  - 사용자 요청 상태 확인
updateWhen:
  - 작업 상태 변경
  - 검증 결과 추가
  - 사용자 요청 드랍
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Progress Tracker

Status values: requested, planned, in-progress, waiting, on-hold, blocked, incomplete, done, dropped

| ID | Status | Request | Evidence | Next Action | Updated |
|---|---|---|---|---|---|
| T-0001 | done | Private 개발/Public Release 분리 및 Leerness 운영 경계 | plan:M-0001 · release-token run 33894555788 · PR #24/#25 | 유지보수 | 2026-09-05 |
| T-0002 | done | v1.0.24 OpenRouter secure multi-key localhost smart router | plan:M-0002 · PR #26 CI 33981095152 · main CI 33981334811 · release run 33981622986 · public v1.0.24 SHA-256 d0397fc8e158559f333d0c5b4b2329646a36825021c656c831104d8794a10211 | 운영 피드백 확인 | 2026-09-06 |
| T-0003 | done | 설정을 미니멀 연결 허브로 재구성하고 플랫폼별 공식 로그인 자격증명 흐름 제공 | plan:M-0003 · validation 34076732991/34076905507/34077476812 success · v1.0.25 이후 login/connection 후속 수정 v1.0.27~v1.0.30 배포 | 유지보수 | 2026-09-10 |
| T-0004 | done | v1.0.31 다계정/Smart Routing/프로필별 reset/CLI 유지보수 완성 | PR #35 · package/lock 1.0.31 sync · PR CI 34425225166 success · main CI 34425507838 success · public release run 34425787487 success · v1.0.31 SHA-256 27a6ea04b9025cf3ca6972dd3bd0e6ef4b08457c8b69c348ee29b8e2cee7d035 | 운영 피드백 확인 | 2026-09-10 |
| T-0005 | done | OpenRouter 추가 프로필/API Key를 직관적으로 추가·추적·정렬·삭제하는 설정 UX | PR #37 · PR CI 34454696918 success · main CI 34455308854 success · v1.0.32에 포함 공개 배포 | 운영 피드백 확인 | 2026-09-11 |
| T-0006 | done | 생성형 미디어 공급자 다계정 + 공식 MCP 잔여량 연동 | PR #38 · PR CI 34458617509 success · main CI 34548918824 success · public release run 34549274719 success · package/lock 1.0.32 sync · v1.0.32 SHA-256 56521664b4e8acf75380e0d1c8ac4fd8738cae69e1d9931642108107b8a25b66 | 운영 피드백 확인 | 2026-09-11 |
