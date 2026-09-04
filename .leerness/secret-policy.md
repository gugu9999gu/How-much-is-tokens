---
leernessRole: secret-policy
readWhen:
  - 스킬/배포/설정 변경 전
updateWhen:
  - 민감정보 정책 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Secret Policy

## Rules
- 환경변수 이름만 기록하고 값은 .env.local, CI secrets, 클라우드 시크릿 매니저로 옮깁니다.
- 코드/문서/로그에 토큰/비밀번호/쿠키/주민번호/카드번호 등을 평문으로 두지 않습니다.
- 변경 전 `leerness scan secrets .`을 실행해 흔적을 확인합니다.

## Patterns scanned
- AWS Access Key (`AKIA[0-9A-Z]{16}`)
- GitHub PAT (`ghp_[A-Za-z0-9]{36}`)
- OpenAI key (`sk-[A-Za-z0-9]{20,}`)
- Anthropic key (`sk-ant-[A-Za-z0-9-]{20,}`)
- Google API key, Slack token, generic private key, hardcoded password
