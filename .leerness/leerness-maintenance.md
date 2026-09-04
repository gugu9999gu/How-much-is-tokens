---
leernessRole: leerness-maintenance
readWhen:
  - 작업 시작
  - 마이그레이션/릴리즈 전
updateWhen:
  - 버전 정책 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Leerness Maintenance

AI agents should check:

```bash
leerness --version
leerness self check .
leerness update --check       # 24h 캐시 자동 감지
leerness update --yes         # 새 버전 발견 시 자동 마이그레이션
cat .leerness/HARNESS_VERSION
npm view leerness version
```
