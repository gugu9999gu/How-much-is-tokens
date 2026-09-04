# Claude Code Development Rules

이 프로젝트는 Leerness를 개발 운영 레이어로 사용한다.

- 세션 시작: `npm run leerness:handoff`
- 현재 상태 확인: `.leerness/current-state.md`, `.leerness/plan.md`, `.leerness/progress-tracker.md`
- 기존 결정 확인: `.leerness/decisions.md`
- 완료 전: 관련 테스트 + 가능하면 `npm run leerness:gate`
- 세션 종료: `npm run leerness:close`

증거 없는 완료 주장을 하지 않는다. 인증정보/API 키/세션 쿠키를 커밋하지 않는다.

개발 저장소는 비공개로 운영하고, 공개 배포는 `gugu9999gu/How-much-is-tokens-releases`에 바이너리·체크섬·릴리스 노트만 게시한다. 공개 배포 저장소로 소스 코드나 `.leerness` 상태를 복사하지 않는다.
