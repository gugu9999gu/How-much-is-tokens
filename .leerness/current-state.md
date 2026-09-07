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
- v1.0.25 미니멀 계정 연결 허브 구현 및 Windows 사전 검증 준비 중. <!-- leerness:auto -->
- 개발 저장소 `gugu9999gu/How-much-is-tokens`는 Private, `gugu9999gu/How-much-is-tokens-releases`는 Public 바이너리 배포 전용으로 운영 중.
- Leerness v1.36.184를 고정 설치하고 Windows CI에서 `leerness gate`를 필수 검증으로 실행함.
- 기본 설정 UX는 공급자별 `연결 상태 + 로그인/다시 로그인 + 계정 추가` 카드와 기본 표시 설정 중심으로 재구성함.
- 기존 다계정 profile raw textarea, Smart Routing, OpenRouter API Key/Management Key 직접 입력, GitHub PAT, Cursor cookie, edge/automation/sync 세부값은 기능을 삭제하지 않고 접힌 `고급 설정`으로 이동함.
- Codex는 `codex login`, Claude는 `claude auth login`, Grok는 `grok login`, Cursor는 `cursor-agent login` 우선/`agent login` fallback, Copilot은 `gh auth login`, Antigravity는 `agy` 실행으로 기존 공급자 인증 흐름을 시작함.
- Codex/Claude/Grok의 `+ 계정`은 `%APPDATA%/how-much-is-tokens/profiles/<provider>/account-N`에 새 격리 config root를 만들고 기존 `CODEX_HOME`/`CLAUDE_CONFIG_DIR`/`GROK_HOME` 환경 경계에서 공식 CLI 로그인을 실행함. 인증 파일을 복사하거나 교체하지 않음.
- Copilot provider는 기존 파일 기반 GitHub 자격증명 외에 `gh auth token`을 credential-manager fallback으로 읽어 `gh auth login` 결과를 수동 PAT 붙여넣기 없이 재사용함.
- OpenRouter는 공식 localhost OAuth PKCE를 사용하며 callback은 `127.0.0.1` 임의 포트에만 bind함. authorization code exchange와 발급 API Key는 main process에서 처리하고 기존 profile safeStorage 저장 함수로 즉시 암호화함; preload/page에는 raw Key를 반환하지 않음.
- OpenRouter v1.0.24 localhost request router의 loopback/fail-closed/no-replay 보안 경계는 변경하지 않음.
- 신규 unit/static/renderer smoke 테스트를 추가했고 정식 테스트 목록/Windows syntax check에 연결함.

## Next
- feature branch Windows 사전 검증에서 syntax, complete `npm test`, Leerness gate, DPAPI secure-storage, renderer minimal-layout smoke를 실행. <!-- leerness:auto -->
- 검증 결함을 수정한 뒤 package/package-lock을 v1.0.25로 npm 동기화하고 PR Windows CI를 통과시킴.
- 성공한 head만 main에 squash merge하고 공개 배포 여부를 결정.

## Blockers
- (없음) <!-- leerness:auto -->
- 실제 공급자 로그인은 사용자 브라우저/CLI 상호작용이 필요하므로 CI는 command selection, 격리 environment, OAuth loopback/exchange boundary를 fixture/mock으로 검증함.
