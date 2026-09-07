---
leernessRole: current-state
readWhen:
  - 세션 시작
  - 작업 이어받기
updateWhen:
  - 현재 상태 변경
  - 다음 작업 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Current State

Updated: 2026-09-07

## Now
- v1.0.25 미니멀 계정 연결 허브 구현 및 feature-head Windows 사전 검증 완료; 정식 PR 준비 중. <!-- leerness:auto -->
- 개발 저장소 `gugu9999gu/How-much-is-tokens`는 Private, `gugu9999gu/How-much-is-tokens-releases`는 Public 바이너리 배포 전용으로 운영 중.
- Leerness v1.36.184를 고정 설치하고 Windows CI에서 `leerness gate`를 필수 검증으로 실행함.
- 기본 설정 UX는 8개 공급자 카드(Codex/Claude/Grok/Cursor/Grok Bot/Copilot/Antigravity/OpenRouter)의 `연결 상태 + 로그인/다시 로그인 + 가능한 경우 계정 추가`와 `항상 위에/시작 시 실행/빈 계정 숨기기` 3개 기본 옵션만 바로 표시함.
- 기존 표시 방식/투명도/밀도/토큰 영역 높이, edge, raw 다계정 profile editor, Smart Routing, 자동화/동기화, OpenRouter 수동 Key/Management Key/router, GitHub PAT, Cursor cookie는 삭제하지 않고 닫힌 `고급 설정`으로 이동함.
- Codex는 `codex login`, Claude는 `claude auth login`, Grok는 `grok login`, Cursor는 `cursor-agent login` 우선/`agent login` fallback, Copilot은 `gh auth login`, Antigravity는 `agy` 실행으로 기존 공급자 인증 흐름을 시작함.
- Grok Bot usage provider는 Cursor 인증을 공유하므로 별도 자격증명을 생성하지 않고 Grok Bot 카드의 로그인도 Cursor 로그인으로 연결함.
- Codex/Claude/Grok의 `+ 계정`은 `%APPDATA%/how-much-is-tokens/profiles/<provider>/account-N`의 충돌 없는 관리형 config root를 자동 선택하고 `CODEX_HOME`/`CLAUDE_CONFIG_DIR`/`GROK_HOME` 환경 경계에서 공식 CLI 로그인을 실행함. 인증 파일을 복사하거나 교체하지 않음.
- Copilot provider는 기존 파일 기반 GitHub 자격증명 외에 `gh auth token`을 credential-manager fallback으로 읽어 `gh auth login` 결과를 수동 PAT 붙여넣기 없이 재사용함.
- OpenRouter는 공식 localhost OAuth PKCE를 사용하며 callback은 `127.0.0.1` 임의 포트에만 bind함. authorization code exchange와 발급 API Key는 main process에서 처리하고 기존 profile safeStorage 저장 함수로 즉시 암호화함; preload/page에는 raw Key를 반환하지 않음.
- OpenRouter v1.0.24 localhost request router의 loopback/fail-closed/no-replay 보안 경계는 변경하지 않음.
- Windows validation run `34076732991`, 기본 옵션 축소 후 `34076905507`, Grok Bot/collision-avoidance까지 포함한 최종 run `34077476812`에서 syntax, complete `npm test`, Leerness gate, DPAPI secure-storage, Electron minimal-layout smoke가 모두 성공함.
- package/package-lock은 npm workflow run `34077244587`로 v1.0.25에 동기화했고 모든 일회성 validation/sync workflow는 feature branch에서 제거함.

## Next
- 정식 PR을 열어 Windows full CI에서 complete regression, Leerness gate, DPAPI, renderer, Antigravity smoke, portable EXE build를 검증. <!-- leerness:auto -->
- 성공한 PR head만 main에 squash merge하고 post-merge CI를 확인.
- `docs/public-release-notes/v1.0.25.md`를 사용해 Public v1.0.25 Release 게시.

## Blockers
- (없음) <!-- leerness:auto -->
- 실제 공급자 로그인은 사용자 브라우저/CLI 상호작용이 필요하므로 CI는 command selection, 격리 environment, OAuth loopback/exchange boundary를 fixture/mock으로 검증함.
