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
- private/public release split 및 cross-repository 배포 권한 검증 완료; v1.0.24 개발 시작 대기 <!-- leerness:auto -->
- `gugu9999gu/How-much-is-tokens` 개발 저장소는 Private으로 운영 중.
- Leerness v1.36.184 소스 커밋을 고정 설치하고 minimal `.leerness` 워크스페이스를 사용 중.
- 공개 바이너리 배포 저장소 `gugu9999gu/How-much-is-tokens-releases`는 Public으로 운영하며 `main`에는 배포 안내용 `README.md`만 유지함.
- 검증된 개발 커밋 `1ac78c01371ca8b8d8bd765d9e8f6bdbcb4ff58a`에서 Windows portable v1.0.23을 재빌드·검증해 공개 Release로 게시함.
- v1.0.23 공개 EXE SHA-256: `f887279ae635d53ad81c0e3737930f0c2e8eb2b29bfa38b71e619c8fc1edf5d5`.
- README 다운로드 경로는 공개 `How-much-is-tokens-releases/releases`로 전환함.
- 정식 Windows CI에서 전체 회귀 테스트, Leerness `gate`, Windows secure-storage/renderer/Antigravity smoke, portable EXE build를 검증함.
- 개발 저장소 Actions secret `RELEASE_REPO_TOKEN`이 등록되었고, 2026-09-05 실제 Actions에서 공개 release 저장소에 대한 read/write 권한을 검증함. 검증은 임시 draft Release 생성 후 삭제 방식으로 완료했으며 자격증명 원문은 저장하지 않음.

## Next
- v1.0.24 OpenRouter/API request-level localhost smart router와 secure multi-key profile 구현 <!-- leerness:auto -->
- 이후 릴리스는 private 개발 저장소의 `.github/workflows/publish-public-release.yml`에서 공개 release 저장소로 EXE/체크섬/명시적 공개 릴리스 노트만 게시.
- localhost router는 loopback-only bind, 별도 local auth token, per-key health/cooldown/failover, streaming 시작 후 unsafe replay 금지, all-keys-unavailable 시 503 fail-closed를 기본 보안 경계로 유지.
- 모든 개발 세션은 시작 시 handoff, 완료 전 gate, 종료 시 session close 절차를 사용.

## Blockers
- (없음) <!-- leerness:auto -->
- private 개발 / public release 분리 및 cross-repository 자동 배포 권한과 관련된 현재 blocker 없음.
