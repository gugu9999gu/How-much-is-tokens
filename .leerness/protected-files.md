---
leernessRole: protected-files
readWhen:
  - 파일 삭제/정리/마이그레이션 전
updateWhen:
  - 보호 대상 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Protected Files

AI agents must not delete or reset these files without explicit user approval.

- .leerness/
- .leerness/skills/
- .leerness/library/
- AGENTS.md
- CLAUDE.md
- .cursor/rules/leerness.mdc
- .github/copilot-instructions.md
- .claude/commands/
- .claude/skills/
- README.md Leerness managed section

Use merge, archive, or deprecated markers instead of deletion.
