# Development Agent Rules

이 저장소의 개발 작업은 Leerness 워크스페이스를 사용한다.

## 세션 시작

1. 의존성이 준비되어 있으면 `npm run leerness:handoff`를 실행한다.
2. `.leerness/current-state.md`, `.leerness/plan.md`, `.leerness/progress-tracker.md`의 현재 상태를 우선 확인한다.
3. 기존 결정과 충돌하는 변경을 하기 전에 `.leerness/decisions.md`를 확인한다.

## 작업 중

- 완료 주장은 코드, 테스트, 빌드 또는 재현 가능한 로그 같은 증거를 동반해야 한다.
- 인증 토큰, 쿠키, OAuth 자격증명, API 키를 저장소에 커밋하지 않는다.
- 개발 저장소와 공개 배포 저장소를 분리한다. 공개 배포 저장소에는 소스 코드나 개발용 Leerness 상태를 게시하지 않는다.
- Windows 동작이 포함된 변경은 기존 Windows GitHub Actions 회귀 테스트를 유지한다.

## 완료 전

1. 관련 테스트를 실행한다.
2. 가능하면 `npm run leerness:gate`를 실행해 완료 증거/보안/드리프트를 확인한다.
3. 세션 종료 전 `npm run leerness:close`를 실행해 다음 세션용 handoff를 남긴다.

## 저장소 역할

- `gugu9999gu/How-much-is-tokens`: 비공개 개발 저장소로 운영할 대상.
- `gugu9999gu/How-much-is-tokens-releases`: 공개 바이너리/체크섬/릴리스 노트 전용 저장소로 운영할 대상.

공개 배포 저장소에는 빌드 산출물과 배포 메타데이터만 전송한다.
