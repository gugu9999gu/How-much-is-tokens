# How much is tokens

화면에 항상 떠 있는 AI 구독 잔여량 위젯입니다. 로컬에 로그인된 Claude, Cursor, Codex, Copilot, Grok, Gemini, Antigravity의 **남은 사용량**을 모아 보여 줍니다.

## 포터블 실행 파일

설치 없이 [Releases](https://github.com/gugu9999gu/How-much-is-tokens/releases) 또는 GitHub Actions의 Windows build artifact에서 `How-much-is-tokens-*-portable.exe`를 받아 실행하세요.

- 설치 마법사 없음
- 작업 표시줄 없이 트레이/위젯으로만 표시
- 설정은 `%APPDATA%\how-much-is-tokens`에 저장
- **시작 시 실행**은 지금 있는 포터블 exe 경로를 시작 프로그램에 등록합니다. exe를 다른 폴더로 옮기면 설정을 한 번 껐다 다시 켜세요.

Windows가 SmartScreen 경고를 띄우면 **추가 정보 → 실행**을 누르면 됩니다. 코드 서명은 없습니다.

## 개발 실행

```bash
npm install
npm test
npm start
```

포터블 exe를 다시 만들려면:

```bash
npm run dist
```

결과물은 `dist/How-much-is-tokens-1.0.3-portable.exe`입니다.

## 사용

- 헤더를 잡고 위치를 옮깁니다.
- 이미 실행 중이면 새 창을 만들지 않고 알려 줍니다.
- `↻` 새로고침, `▣` 간단/자세히, `⚙` 설정, `–` 트레이로 숨기기
- 닫기 대신 숨기며, 종료는 설정 또는 트레이 메뉴에서 합니다.
- Copilot이 안 보이면 GitHub 토큰을 설정에 붙여 넣으세요.
- Claude가 “로그인 필요”이면 터미널에서 `claude`를 한 번 실행해 세션을 갱신하세요.
- Antigravity는 `agy`를 한 번 실행한 뒤 위젯을 새로고침하면 공식 status-line bridge가 자동 연결됩니다.

## 지원 서비스

| 서비스 | 데이터 소스 |
| --- | --- |
| Claude Code | `~/.claude/.credentials.json` |
| Cursor | Cursor 앱 `state.vscdb` 세션 |
| Codex / ChatGPT | `~/.codex/auth.json` |
| GitHub Copilot / VS Code | Copilot 로그인 파일 또는 설정의 GitHub 토큰 |
| Grok | `~/.grok/auth.json` |
| Gemini CLI | `~/.gemini/oauth_creds.json` (있을 때만) |
| Antigravity | 공식 custom status-line JSON의 `quota`, `plan_tier`, `email` |

### Antigravity

Antigravity는 로그인 토큰이나 Windows Credential Manager를 직접 읽지 않습니다. 위젯은 Antigravity CLI가 공식적으로 지원하는 custom status-line command를 자동으로 연결하고, CLI가 전달한 JSON에서 필요한 값만 로컬 snapshot에 저장합니다.

- `quota`: Gemini / Claude·GPT의 5시간·주간 quota 등 CLI가 실제로 보고한 bucket만 표시
- `plan_tier`: 현재 계정의 플랜 표시
- `email`: 원문을 저장하지 않고 SHA-256 기반 계정 ID + 마스킹된 주소만 저장
- 여러 Google 계정으로 전환해 `agy`를 실행하면 계정별 snapshot을 유지하고 상세 보기에서 각각의 quota를 분리 표시
- 15분 이상 새 status-line 이벤트가 없으면 이전 값으로 표시
- 기존에 사용자가 별도의 custom status-line command를 설정해 둔 경우에는 덮어쓰지 않음
- `stack_with_default: true`를 사용해 Antigravity 기본 status line은 그대로 유지

Antigravity의 **AI Credits 잔액**은 현재 공식 custom status-line JSON 스키마에 포함되지 않습니다. 따라서 잔액을 추정하거나 비공개 API로 우회하지 않으며, 위젯에는 `useG1Credits` 설정의 사용/미사용 상태만 표시합니다. 실제 잔액과 결제 주기 사용량은 Antigravity CLI의 `/credits` 화면을 기준으로 확인하세요.

다른 provider는 각 앱/CLI가 이미 보유한 로컬 로그인 정보와 사용량 엔드포인트를 이용합니다. 토큰을 생성형 요청에 사용하지 않으며, Antigravity는 별도로 공식 status-line export만 사용합니다.

## 검증용 CLI

Electron 없이 현재 잔여량만 보려면:

```bash
npm run probe
```

## Windows 자동 빌드

`.github/workflows/build-windows.yml`이 `main` push마다 Windows runner에서 다음을 실행합니다.

1. `npm ci`
2. JavaScript syntax check
3. `npm test`
4. `npm run dist`
5. `How-much-is-tokens-windows-portable` artifact 업로드
