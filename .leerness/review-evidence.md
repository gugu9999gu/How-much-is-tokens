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
- After pre-PR validation, request forwarding was further hardened to strip client credential-style headers (`x-api-key`, `api-key`, OpenAI key headers, cookie) and unauthenticated `/health` output was reduced to non-sensitive status only.
- Network replay policy was further tightened: explicit 401/402/403/429 may fail over before response commit; network failure only retries idempotent/safe GET/HEAD/OPTIONS, while ambiguous POST failures return 502 without trying another key. Unit coverage was added for both paths.

## 2026-09-06 — v1.0.24 formal CI, merge, and public release
- PR #26 formal Windows CI run `33981095152`: dependency install, pinned Leerness workspace, syntax checks, complete regression suite, Leerness gate, Windows DPAPI multi-profile secure-storage smoke, renderer smoke, Antigravity smoke, and v1.0.24 portable EXE build all succeeded. This run included the final credential-header stripping, minimal `/health`, POST network no-replay, and safe GET network failover tests.
- PR #26 was squash-merged to main as commit `0e80f71efbd4b8665f3fab19015d8ec39fea3b13`.
- Main post-merge Windows CI run `33981334811`: complete regression suite, Leerness gate, Windows secure-storage/renderer/Antigravity smoke, v1.0.24 portable build, and main artifact upload all succeeded.
- The existing `Publish Public Release` workflow was dispatched for `v1.0.24`; release run `33981622986` succeeded through private source checkout, regression tests, secure-storage/renderer smoke, metadata validation, reproducible portable build, SHA-256 generation, public repository access, and release-asset-only publishing.
- Public latest Release is `v1.0.24` in `gugu9999gu/How-much-is-tokens-releases` and contains exactly the intended release assets: `How-much-is-tokens-1.0.24-portable.exe` and `SHA256SUMS.txt` plus public release notes metadata.
- Published EXE SHA-256: `d0397fc8e158559f333d0c5b4b2329646a36825021c656c831104d8794a10211`.
- The one-time workflow used only to dispatch v1.0.24 was removed from main after successful dispatch; the persistent `publish-public-release.yml` remains the release path.

## 2026-09-07 — v1.0.25 minimal account connection hub pre-PR verification
- The settings UI was reduced to provider connection cards plus three common toggles; legacy display/routing/manual-credential controls remain available in a collapsed advanced disclosure rather than being removed.
- Provider login launchers use fixed command/argument mappings and provider-specific config-root environment variables. Codex/Claude/Grok additional accounts allocate app-managed isolated directories; no auth file copy/swap operations are present.
- Grok Bot is explicitly represented as a separate usage card while reusing Cursor authentication, matching the existing `grokbot` provider implementation.
- OpenRouter OAuth uses a random IPv4 loopback callback path, S256 PKCE, main-process code exchange, and existing safeStorage profile persistence. The raw OAuth-issued key is not exposed through preload/page APIs.
- Copilot now reuses `gh auth token` as a credential-manager fallback after existing auth-file checks, so `gh auth login` can be used without requiring a PAT paste into app settings.
- Windows validation run `34076732991`: syntax checks, complete regression suite, Leerness gate, Windows secure-storage smoke, and Electron minimal-settings renderer smoke all succeeded.
- Windows validation run `34076905507`, after reducing the basic settings surface further, repeated the same complete validation successfully.
- Package/package-lock version sync run `34077244587` used npm's own version command and succeeded; both files now report `1.0.25`.
- After those runs, Grok Bot shared-auth presentation and filesystem collision avoidance for managed account directories were added and require one final feature-head validation before PR.
