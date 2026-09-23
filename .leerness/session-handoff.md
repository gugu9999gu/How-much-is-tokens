# Session Handoff

Last generated: 2026-09-23T02:27:45.666Z

## Completed
- T-0001 Private 개발/Public Release 분리 및 Leerness 운영 경계 → next: 유지보수
- T-0002 v1.0.24 OpenRouter secure multi-key localhost smart router → next: 운영 피드백 확인
- T-0003 설정을 미니멀 연결 허브로 재구성하고 플랫폼별 공식 로그인 자격증명 흐름 제공 → next: 유지보수
- T-0004 v1.0.31 다계정/Smart Routing/프로필별 reset/CLI 유지보수 완성 → next: 운영 피드백 확인
- T-0005 OpenRouter 추가 프로필/API Key를 직관적으로 추가·추적·정렬·삭제하는 설정 UX → next: 운영 피드백 확인
- T-0006 생성형 미디어 공급자 다계정 + 공식 MCP 잔여량 연동 → next: 운영 피드백 확인

## In Progress
- 없음

## Incomplete / Waiting / On Hold / Blocked
- T-0007 Claude 5시간 한도, Claude/Codex 리셋 쿠폰 잔여, 설치 CLI 버전·업데이트 가능, 플랫폼별 결제·갱신일 표시 → next: 커밋 후 v1.0.34를 How-much-is-tokens-releases에 게시

## Dropped
- 없음

## Verification
```
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
- Final Windows feature-head validation run `34077476812`, including Grok Bot shared-auth presentation and filesystem collision avoidance for managed login profiles, passed syntax checks, the complete regression suite, Leerness gate, Windows secure-storage smoke, and Electron minimal-settings renderer smoke.
- All one-time validation/version-sync workflows were deleted from the feature branch before opening the formal PR.
```

## Recommended Direction
- 다음 우선순위를 사용자와 정합니다.

## Next Exact Step
- 커밋 후 태그 v1.0.34로 publish-public-release를 실행해 portable EXE와 SHA256SUMS.txt만 gugu9999gu/How-much-is-tokens-releases에 게시한다.
