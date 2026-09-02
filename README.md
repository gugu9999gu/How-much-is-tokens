# How much is tokens

화면에 항상 떠 있는 AI 구독 잔여량 위젯입니다. 로컬에 로그인된 Claude, Cursor, Grok Bot, Codex, Copilot, Grok, Antigravity의 **남은 사용량**을 모아 보여 줍니다.

> Gemini CLI provider는 현재 위젯 표시 대상에서 제외했습니다. Google 계열 사용량은 Antigravity quota만 표시합니다.

## 포터블 실행 파일

설치 없이 [Releases](https://github.com/gugu9999gu/How-much-is-tokens/releases) 또는 GitHub Actions의 Windows build artifact에서 `How-much-is-tokens-*-portable.exe`를 받아 실행하세요.

- 설치 마법사 없음
- 작업 표시줄 없이 트레이/위젯으로만 표시
- 설정은 `%APPDATA%\how-much-is-tokens`에 저장
- **시작 시 실행**은 지금 있는 포터블 exe 경로를 시작 프로그램에 등록합니다. exe를 다른 폴더로 옮기면 설정을 한 번 껐다 다시 켜세요.
- v1.0.6부터 표시되는 서비스/카드 수에 맞춰 위젯 높이가 자동으로 늘어납니다.
- v1.0.7부터 카드는 AI 제공자별로 정렬하고 섹션을 나눠 표시합니다.
- v1.0.8부터 5시간 한도와 주간 한도가 함께 제공되는 서비스는 두 한도를 모두 상세 보기에 표시합니다.
- v1.0.9부터 5시간 한도가 있는 서비스는 각 quota를 독립 그래프로 표시하고, Antigravity 1.1.11+는 공식 `/usage` 명령으로 quota를 자동 갱신합니다.
- v1.0.10부터 설정에서 사용량 시각화를 **원형 / 막대 / 숫자** 방식으로 전환할 수 있습니다.
- v1.0.11부터 `항상 위에` 토글 비활성화가 즉시 Windows z-order에 반영됩니다.
- v1.0.12부터 화면 높이를 넘으면 카드 영역만 스크롤하며, `촘촘하게`와 상/우/하/좌 **엣지 숨김 패널**을 지원합니다.
- v1.0.13부터 **토큰 영역 최대 높이**를 직접 지정할 수 있고, 엣지 방향을 연속 변경해도 헤더가 화면 밖으로 밀리지 않도록 재배치 로직을 안정화했습니다.

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

결과물은 `dist/How-much-is-tokens-1.0.13-portable.exe`입니다.

## 사용

- 일반 모드에서는 헤더를 잡고 위치를 옮깁니다. 엣지 숨김 패널 모드에서는 위치/hover geometry 일치를 위해 드래그를 막습니다.
- 이미 실행 중이면 새 창을 만들지 않고 알려 줍니다.
- `↻` 새로고침, `▣` 간단/자세히, `⚙` 설정, `–` 트레이로 숨기기
- 표시 카드가 추가/제거되면 콘텐츠 높이를 다시 계산합니다.
- 콘텐츠가 현재 모니터 작업영역보다 길면 창 전체를 화면 안에 제한하고 카드 목록만 스크롤합니다.
- 설정 → 표시 → `토큰 영역 최대 높이`에 px 값을 넣으면 **카드 목록 영역만** 그 높이까지 표시합니다. `0`은 모니터 높이에 맞춘 자동 모드입니다.
- 토큰 영역 높이를 제한해도 헤더와 최상위 `.shell` 컨테이너는 스크롤되지 않으므로 바깥 라운딩 디자인이 유지됩니다.
- `촘촘하게`는 상세 데이터는 유지하고 카드/그룹 여백만 줄입니다.
- AI 제공자 정렬 순서는 `OpenAI → Anthropic → Google → xAI → Cursor → GitHub → 기타`입니다.
- Grok과 Grok Bot은 xAI 섹션에 함께 표시하며, Grok Bot의 실제 로그인/사용량 조회는 Cursor 계정을 사용합니다.
- 설정 → 표시 → `사용량 표시`에서 `원형`, `막대`, `숫자` 중 하나를 선택하면 저장과 동시에 전체 카드에 적용됩니다.
- 상세 모드에서 5시간/주간 등 여러 quota가 있는 서비스는 선택한 시각화 방식으로 모든 quota를 각각 표시합니다.
- Compact 모드에서는 대표 잔여량 1개만 표시하되 선택한 시각화 방식은 유지합니다.
- 닫기 대신 숨기며, 종료는 설정 또는 트레이 메뉴에서 합니다.
- Copilot이 안 보이면 GitHub 토큰을 설정에 붙여 넣으세요.
- Claude가 “로그인 필요”이면 터미널에서 `claude`를 한 번 실행해 세션을 갱신하세요.
- Grok Bot은 Cursor 계정 세션을 사용하므로 Cursor 또는 Grok Bot에 로그인되어 있어야 합니다.
- Antigravity 1.1.11+는 위젯 새로고침만으로 quota가 자동 갱신됩니다. 최초 로그인 또는 완전히 만료/해제된 세션만 `agy`에서 다시 로그인해야 합니다.

### 토큰 영역 최대 높이

`토큰 영역 최대 높이`는 BrowserWindow 전체 높이 제한이 아닙니다. 카드와 quota가 들어가는 `#list` 영역에만 적용됩니다.

- `0`: 자동. 현재 모니터의 작업영역을 넘지 않는 범위에서 위젯이 콘텐츠에 맞춰 커짐
- `120~2000`: 지정한 px를 `#list`의 최대 높이로 사용
- 120보다 작은 양수는 120으로, 2000보다 큰 값은 2000으로 정규화
- 목록이 지정 높이를 넘으면 `#list` 내부에만 스크롤 생성
- 제목바, 바깥 padding/border, `.shell`의 라운딩은 고정되어 디자인이 잘리지 않음
- 설정 화면 자체의 스크롤/최대 높이와는 별도 설정

### 엣지 숨김 패널

설정 → `화면 가장자리`에서 활성화하고 `상 / 우 / 하 / 좌`를 선택할 수 있습니다.

- 평소에는 선택한 모니터 가장자리 밖으로 숨고 약 3px만 남김
- 화면 가장자리의 고정 trigger 영역에 커서를 올리면 ease-out으로 표시
- trigger는 움직이는 패널 좌표와 분리되어 애니메이션 중 기준점이 흔들리지 않음
- 열린 뒤에는 패널 또는 trigger 안에 커서가 있는 동안 유지
- 둘 다 벗어난 상태가 700ms 지속된 뒤 숨김
- 방향을 변경하면 이전 방향의 hidden/showing 좌표를 폐기하고 **완전히 표시된 새 shown bounds**부터 다시 계산
- 상/우/하/좌를 빠르게 연속 변경할 때 revision guard로 마지막 선택만 재확인하여 헤더/설정/간소화 버튼이 화면 밖으로 밀리는 문제 방지
- 방향 변경 직후 별도 grace를 적용해 패널이 새 위치로 이동한 순간 바로 다시 숨는 현상 방지
- 모니터 해상도/작업영역 변경 시 위치와 trigger를 재계산

## 지원 서비스

| 서비스 | 데이터 소스 |
| --- | --- |
| Claude Code | `~/.claude/.credentials.json` |
| Cursor | Cursor 앱 `state.vscdb` 세션 |
| Grok Bot | Cursor 세션 + Cursor DashboardService의 Grok Bot usage RPC |
| Codex / ChatGPT | `~/.codex/auth.json` |
| GitHub Copilot / VS Code | Copilot 로그인 파일 또는 설정의 GitHub 토큰 |
| Grok / Grok Build | `~/.grok/auth.json` |
| Antigravity | `agy -p "/usage"` (1.1.11+) 우선, 공식 custom status-line snapshot fallback |

### 사용량 시각화

설정의 `사용량 표시`에서 세 가지 모드를 선택할 수 있습니다. 선택값은 `%APPDATA%\how-much-is-tokens\settings.json`에 저장되며 다음 실행에도 유지됩니다. 기존 사용자처럼 설정값이 없는 경우 기본값은 `원형`입니다.

- **원형**: 남은 퍼센트를 원형 게이지로 표시
- **막대**: 남은 퍼센트를 가로 진행률 막대로 표시
- **숫자**: 큰 퍼센트 숫자를 중심으로 표시
- 잘못된/구버전 설정값은 자동으로 `원형`으로 복구
- 여러 quota가 있는 카드에서는 5시간, 주간, 모델별 주간 한도 등이 모두 선택한 시각화 방식으로 함께 전환

### 5시간 / 주간 quota

5시간 한도와 주간 한도를 동시에 제공하는 서비스는 상세 보기에서 quota별 사용량을 각각 표시합니다. 각 항목에는 남은 `%`, quota 이름, 리셋까지 남은 시간이 표시됩니다.

- Claude: `5시간 한도`, `주간 한도`, Sonnet/Opus 등 모델별 주간 한도가 있으면 추가 표시
- Codex / ChatGPT: 5시간 session window와 주간 window를 각각 표시
- Antigravity: `Gemini 5시간 한도`, `Gemini 주간 한도`, `Claude/GPT 5시간 한도`, `Claude/GPT 주간 한도`를 실제로 제공된 만큼 표시
- 실제 API/CLI에 특정 bucket이 없는 경우에는 존재하지 않는 한도를 추정해서 만들지 않음

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

### Antigravity 자동 quota 갱신

Antigravity 로그인 토큰이나 Windows Credential Manager의 값을 위젯이 직접 읽거나 복사하지 않습니다.

`agy` 1.1.11 이상에서는 공식 CLI가 read-only slash command를 headless print mode에서 직접 처리합니다. 따라서 위젯 새로고침 시 다음 공식 명령을 백그라운드에서 실행합니다.

```bash
agy -p "/usage"
```

이 명령은 모델 turn을 만들거나 AI quota를 소모하지 않고 실시간 quota를 다시 조회합니다. 위젯은 명령의 TSV 결과에서 Gemini / Claude·GPT의 5시간 및 주간 잔여량과 리셋 시각을 읽습니다.

안전장치:

- 먼저 `agy --version`을 확인하고 **1.1.11 이상에서만** `/usage` headless 호출을 사용
- 1.1.10 이하에서는 같은 입력이 일반 프롬프트로 처리될 수 있으므로 절대 자동 호출하지 않음
- 최신 CLI 호출이 실패하면 기존 공식 custom status-line snapshot으로 fallback
- CLI가 OS keyring에 저장한 로그인 세션을 자체적으로 사용하므로 위젯은 자격증명 값을 알 수 없음
- 최초 로그인, 로그아웃, 계정 권한 해제처럼 refresh로 복구할 수 없는 인증 상태만 사용자가 `agy`에서 다시 로그인해야 함

Windows에서는 fallback용 status-line launcher와 PowerShell bridge를 `~/.gemini/antigravity-cli/` 아래에 유지합니다. 기존 사용자 custom status-line 명령은 덮어쓰지 않습니다.

Antigravity의 **AI Credits 잔액**은 공식 status-line과 현재 quota 출력에서 별도 numeric balance로 안정적으로 노출되는 경우에만 향후 표시합니다. 현재 위젯은 잔액을 추정하거나 비공개 API를 호출하지 않습니다.

다른 provider는 각 앱/CLI가 이미 보유한 로컬 로그인 정보와 사용량 엔드포인트를 이용합니다. 토큰을 생성형 요청에 사용하지 않습니다.

## 검증용 CLI

Electron 없이 현재 잔여량만 보려면:

```bash
npm run probe
```

## Windows 자동 빌드

`.github/workflows/build-windows.yml`이 PR과 `main` push에서 Windows runner로 다음을 검증합니다.

1. `npm ci`
2. JavaScript syntax check
3. `npm test` (Antigravity status-line + live `/usage` parser + Grok Bot + provider grouping + quota pairing + visualization + always-on-top + edge/height geometry)
4. 실제 `cmd.exe → PowerShell` Antigravity status-line bridge smoke test
5. `npm run dist`
6. `How-much-is-tokens-windows-portable` artifact 업로드
