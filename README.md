# How much is tokens

화면에 항상 떠 있는 AI 구독 잔여량 위젯입니다. 로컬에 로그인된 Claude, Cursor, Grok Bot, Codex, Copilot, Grok, Antigravity의 **남은 사용량**을 모아 보여 줍니다.

> Gemini CLI provider는 현재 위젯 표시 대상에서 제외했습니다. Google 계열 사용량은 Antigravity quota만 표시합니다.

## 포터블 실행 파일

설치 없이 [Releases](https://github.com/gugu9999gu/How-much-is-tokens/releases) 또는 GitHub Actions의 Windows build artifact에서 `How-much-is-tokens-*-portable.exe`를 받아 실행하세요.

- 설치 마법사 없음
- 작업 표시줄 없이 트레이/위젯으로만 표시
- 설정은 `%APPDATA%\how-much-is-tokens`에 저장
- **시작 시 실행**은 지금 있는 포터블 exe 경로를 시작 프로그램에 등록합니다. exe를 다른 폴더로 옮기면 설정을 한 번 껐다 다시 켜세요.
- v1.0.6부터 표시되는 서비스/카드 수에 맞춰 위젯 높이가 자동으로 늘어나며, 앱 내부의 최대 높이 제한을 두지 않습니다.
- v1.0.7부터 카드는 AI 제공자별로 정렬하고 섹션을 나눠 표시합니다.
- v1.0.8부터 5시간 한도와 주간 한도가 함께 제공되는 서비스는 두 한도를 모두 상세 보기에 표시합니다.

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

결과물은 `dist/How-much-is-tokens-1.0.8-portable.exe`입니다.

## 사용

- 헤더를 잡고 위치를 옮깁니다.
- 이미 실행 중이면 새 창을 만들지 않고 알려 줍니다.
- `↻` 새로고침, `▣` 간단/자세히, `⚙` 설정, `–` 트레이로 숨기기
- 표시 카드가 추가/제거되면 콘텐츠 높이를 다시 계산해 위젯 창 높이도 자동 조정합니다.
- AI 제공자 정렬 순서는 `OpenAI → Anthropic → Google → xAI → Cursor → GitHub → 기타`입니다.
- Grok과 Grok Bot은 xAI 섹션에 함께 표시하며, Grok Bot의 실제 로그인/사용량 조회는 Cursor 계정을 사용합니다.
- 상세 모드는 provider가 전달한 quota window를 임의로 4개로 자르지 않습니다. 따라서 `5시간 한도`와 `주간 한도`가 모두 존재하면 둘 다 표시됩니다.
- 닫기 대신 숨기며, 종료는 설정 또는 트레이 메뉴에서 합니다.
- Copilot이 안 보이면 GitHub 토큰을 설정에 붙여 넣으세요.
- Claude가 “로그인 필요”이면 터미널에서 `claude`를 한 번 실행해 세션을 갱신하세요.
- Grok Bot은 Cursor 계정 세션을 사용하므로 Cursor 또는 Grok Bot에 로그인되어 있어야 합니다.
- Antigravity는 `agy`를 한 번 실행한 뒤 위젯을 새로고침하면 공식 status-line bridge가 자동 연결됩니다.

## 지원 서비스

| 서비스 | 데이터 소스 |
| --- | --- |
| Claude Code | `~/.claude/.credentials.json` |
| Cursor | Cursor 앱 `state.vscdb` 세션 |
| Grok Bot | Cursor 세션 + Cursor DashboardService의 Grok Bot usage RPC |
| Codex / ChatGPT | `~/.codex/auth.json` |
| GitHub Copilot / VS Code | Copilot 로그인 파일 또는 설정의 GitHub 토큰 |
| Grok / Grok Build | `~/.grok/auth.json` |
| Antigravity | 공식 custom status-line JSON의 `quota`, `plan_tier`, `email` |

### 5시간 / 주간 한도

5시간 한도와 주간 한도를 동시에 제공하는 서비스는 상세 보기에서 두 값을 각각 별도 chip으로 표시합니다.

- Claude: `5시간 한도`, `주간 한도`, 모델별 주간 한도가 있으면 함께 표시
- Codex / ChatGPT: rate-limit primary/secondary window를 모두 표시하며 5시간 window는 `5시간 한도`, 장기 window는 `주간 한도`로 표시
- Antigravity: 공식 status-line에서 전달된 `Gemini 5시간 한도` + `Gemini 주간 한도`, `Claude/GPT 5시간 한도` + `Claude/GPT 주간 한도`를 모두 표시
- 실제 API/status-line에 특정 bucket이 없는 경우에는 존재하지 않는 한도를 추정해서 만들지 않음

### 제공자별 정렬

카드는 서비스 배열의 등록 순서가 아니라 각 서비스의 AI 제공자 메타데이터를 기준으로 정렬됩니다. UI에서는 각 제공자 이름과 구분선을 표시하고 같은 제공자의 카드를 하나의 섹션에 연속 배치합니다.

- OpenAI: Codex / ChatGPT
- Anthropic: Claude
- Google: Antigravity
- xAI: Grok / Grok Bot
- Cursor: Cursor
- GitHub: Copilot
- 새 provider가 메타데이터 없이 추가된 경우 `기타` 섹션으로 자동 이동

### Grok Bot

Grok Bot은 일반 Grok/Grok Build와 별도 카드로 표시합니다. Grok Bot 자체가 Cursor 계정으로 로그인하고 사용량/결제를 Cursor 계정에서 관리하므로, 위젯도 Cursor가 로컬에 보유한 로그인 세션을 읽기 전용으로 재사용합니다.

- `GetSandUsageStatus`: Grok Bot 주간 사용률, 남은 %, 리셋 시각, 사용 가능/소진 상태
- `GetCurrentPeriodUsage`: on-demand 사용액, 한도, 잔액 및 결제 주기 종료 시각
- Cursor 카드와 Grok Bot 카드는 같은 로그인 세션을 공유하지만 quota는 서로 다른 product meter로 구분해 표시
- Grok Bot 인증정보를 별도 파일에 복사하거나 저장하지 않음

Cursor/Grok Bot 사용량 RPC는 현재 Cursor 앱/대시보드가 사용하는 계정 API이며 공개 REST 문서로 고정된 API는 아닙니다. 응답 스키마가 바뀔 수 있으므로 parser 테스트를 함께 유지합니다.

### Antigravity

Antigravity는 로그인 토큰이나 Windows Credential Manager를 직접 읽지 않습니다. 위젯은 Antigravity CLI가 공식적으로 지원하는 custom status-line command를 자동으로 연결하고, CLI가 전달한 JSON에서 필요한 값만 로컬 snapshot에 저장합니다.

Windows에서는 status-line launcher와 PowerShell bridge를 `~/.gemini/antigravity-cli/` 아래에 설치합니다. v1.0.4부터 Antigravity에 직접 `powershell.exe -File "..."` 경로를 전달하지 않고, 따옴표가 없는 `cmd.exe` launcher 명령을 사용합니다. 이전 v1.0.3에서 `Statusline Error`와 `-File '"C:\...ps1"'` 형태의 경로 오류가 발생한 경우 새 버전을 실행하고 위젯을 새로고침하면 기존 위젯 status-line 설정을 자동 교체합니다.

- `quota`: Gemini / Claude·GPT의 5시간·주간 quota 등 CLI가 실제로 보고한 bucket만 표시
- `plan_tier`: 현재 계정의 플랜 표시
- `email`: 원문을 저장하지 않고 SHA-256 기반 계정 ID + 마스킹된 주소만 저장
- 여러 Google 계정으로 전환해 `agy`를 실행하면 계정별 snapshot을 유지하고 상세 보기에서 각각의 quota를 분리 표시
- 15분 이상 새 status-line 이벤트가 없으면 이전 값으로 표시
- 기존에 사용자가 별도의 custom status-line command를 설정해 둔 경우에는 덮어쓰지 않음
- 위젯이 만든 이전 `how-much-is-tokens-antigravity-statusline.ps1` 설정은 새 launcher 방식으로 자동 마이그레이션
- `stack_with_default: true`를 사용해 Antigravity 기본 status line은 그대로 유지

Antigravity의 **AI Credits 잔액**은 현재 공식 custom status-line JSON 스키마에 포함되지 않습니다. 따라서 잔액을 추정하거나 비공개 API로 우회하지 않으며, 위젯에는 `useG1Credits` 설정의 사용/미사용 상태만 표시합니다. 실제 잔액과 결제 주기 사용량은 Antigravity CLI의 `/credits` 화면을 기준으로 확인하세요.

다른 provider는 각 앱/CLI가 이미 보유한 로컬 로그인 정보와 사용량 엔드포인트를 이용합니다. 토큰을 생성형 요청에 사용하지 않으며, Antigravity는 별도로 공식 status-line export만 사용합니다.

## 검증용 CLI

Electron 없이 현재 잔여량만 보려면:

```bash
npm run probe
```

## Windows 자동 빌드

`.github/workflows/build-windows.yml`이 PR과 `main` push에서 Windows runner로 다음을 검증합니다.

1. `npm ci`
2. JavaScript syntax check
3. `npm test` (Antigravity + Grok Bot parser + provider grouping + 5시간/주간 quota pairing)
4. 실제 `cmd.exe → PowerShell` Antigravity status-line bridge smoke test
5. `npm run dist`
6. `How-much-is-tokens-windows-portable` artifact 업로드
