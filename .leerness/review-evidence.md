---
leernessRole: review-evidence
readWhen:
  - 진행 보고
  - 릴리즈 검토
updateWhen:
  - 검증 결과 기록
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Review Evidence

Verification command/result history. Append-only.

## 2026-09-05 — Private/Public release split final verification
- GitHub Actions release-token verification run `33894555788`: success on latest attempt.
- `RELEASE_REPO_TOKEN` was present only as a masked Actions secret (`GH_TOKEN: ***`); no credential value was written to repository state.
- Verification used the token to read `gugu9999gu/How-much-is-tokens-releases`, create a temporary draft Release, then delete that Release/tag; step ended with `RELEASE_REPO_TOKEN read/write verification passed`.
- Public release repository was checked after cleanup and contained only the intended v1.0.23 Release with portable EXE and `SHA256SUMS.txt`.
- PR #24 Windows CI run `33946076642`: full regression tests, Leerness gate, Windows secure-storage smoke, renderer smoke, Antigravity bridge smoke, and portable EXE build succeeded. PR artifact upload was intentionally skipped after the public GitHub Releases repository became the canonical distribution path.
- Leerness session-close run `33967758023`: `npm run leerness:gate`, `npm run leerness:close`, and handoff commit all succeeded.

## 2026-09-06 — v1.0.24 OpenRouter secure multi-key localhost router pre-PR verification
- Initial validation run `33980256391` found an outdated settings-reset assertion after `openRouterProfiles` became safe-reset-preserved metadata; product code was not bypassed and the regression expectation was updated.
- Validation run `33980334809` passed the complete regression suite and exposed four credential-shaped router test fixtures through Leerness secret scanning. Fixtures were rebuilt at runtime rather than adding a scanner exception.
- Validation run `33980435204` passed the complete regression suite and Leerness gate, then Windows DPAPI smoke exposed a real configured-status cache invalidation bug after profile-secret mutation. The settings status cache now has an explicit invalidation boundary used by profile secret/token mutations.
- Final pre-PR validation run `33980655618`: syntax checks, complete `npm test`, `npm run leerness:gate`, Windows DPAPI multi-profile secure-storage smoke, and Electron renderer smoke all succeeded.
- Router unit tests cover 127.0.0.1 binding, local Bearer auth, 429 cooldown + priority failover, max-remaining selection, all-key 503 fail-closed, and no replay after a streaming response has begun.
- Security tests verify raw API/Management/local router tokens are not persisted in `settings.json`, secret ciphertext is stored through Electron safeStorage, the renderer has no raw-token getter, and the localhost token is copied from main-process code only.
- After pre-PR validation, request forwarding was further hardened to strip client credential-style headers (`x-api-key`, `api-key`, OpenAI key headers, cookie) and unauthenticated `/health` output was reduced to non-sensitive status only. These final changes must be revalidated by the formal PR Windows CI before merge.
