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

Updated: 2026-09-05

## Now
- 개발 저장소에 Leerness v1.36.184 소스 커밋을 고정 설치하고 minimal `.leerness` 워크스페이스를 초기화함.
- 공개 바이너리 배포 저장소 `gugu9999gu/How-much-is-tokens-releases`를 생성·초기화했으며 `main`에는 배포 안내용 `README.md`만 유지함.
- 검증된 개발 커밋 `1ac78c01371ca8b8d8bd765d9e8f6bdbcb4ff58a`에서 Windows portable v1.0.23을 재빌드·검증해 공개 Release로 게시함.
- v1.0.23 공개 EXE SHA-256: `f887279ae635d53ad81c0e3737930f0c2e8eb2b29bfa38b71e619c8fc1edf5d5`.

## Next
- `gugu9999gu/How-much-is-tokens` 개발 저장소 visibility를 Private으로 변경.
- 공개 release 저장소에만 Contents read/write 가능한 credential을 개발 저장소 Actions secret `RELEASE_REPO_TOKEN`으로 등록해 이후 `.github/workflows/publish-public-release.yml`이 private source에서 직접 배포하도록 전환.
- 이후 모든 개발 세션은 시작 시 handoff, 완료 전 gate, 종료 시 session close 절차를 사용.

## Blockers
- 현재 연결된 GitHub 액션에는 저장소 visibility 변경 및 Actions secret 등록 mutation이 노출되어 있지 않아 이 두 관리자 작업은 GitHub UI에서 수행해야 함.
