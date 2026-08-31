# How much is tokens

화면에 항상 떠 있는 AI 구독 잔여량 위젯입니다. 로컬에 로그인된 Claude, Cursor, Codex, Copilot, Grok, Gemini의 **남은 사용량**을 모아 보여 줍니다.

## 포터블 실행 파일

설치 없이 [Releases](https://github.com/gugu9999gu/How-much-is-tokens/releases)에서 `How-much-is-tokens-*-portable.exe`를 받아 실행하세요.

- 설치 마법사 없음
- 작업 표시줄 없이 트레이/위젯으로만 표시
- 설정은 `%APPDATA%\how-much-is-tokens`에 저장
- **시작 시 실행**은 지금 있는 포터블 exe 경로를 시작 프로그램에 등록합니다. exe를 다른 폴더로 옮기면 설정을 한 번 껐다 다시 켜세요.

Windows가 SmartScreen 경고를 띄우면 **추가 정보 → 실행**을 누르면 됩니다. 코드 서명은 없습니다.

## 개발 실행

```bash
npm install
npm start
```

포터블 exe를 다시 만들려면:

```bash
npm run dist
```

결과물은 `dist/How-much-is-tokens-1.0.0-portable.exe`입니다.

## 사용

- 헤더를 잡고 위치를 옮깁니다.
- `↻` 새로고침, `▣` 간단/자세히, `⚙` 설정, `–` 트레이로 숨기기
- 닫기 대신 숨기며, 종료는 설정 또는 트레이 메뉴에서 합니다.
- Copilot이 안 보이면 GitHub 토큰을 설정에 붙여 넣으세요.
- Claude가 “로그인 필요”이면 터미널에서 `claude`를 한 번 실행해 세션을 갱신하세요.

## 지원 서비스

| 서비스 | 자격 증명 |
| --- | --- |
| Claude Code | `~/.claude/.credentials.json` |
| Cursor | Cursor 앱 `state.vscdb` 세션 |
| Codex / ChatGPT | `~/.codex/auth.json` |
| GitHub Copilot / VS Code | Copilot 로그인 파일 또는 설정의 GitHub 토큰 |
| Grok | `~/.grok/auth.json` |
| Gemini CLI | `~/.gemini/oauth_creds.json` (있을 때만) |

각 서비스 공식 공개 API가 아니라, 해당 앱/CLI가 쓰는 사용량 엔드포인트를 읽습니다. 요청은 조회만 하며 토큰을 소모하지 않습니다.

## 검증용 CLI

Electron 없이 현재 잔여량만 보려면:

```bash
npm run probe
```
