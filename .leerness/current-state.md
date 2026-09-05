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
- 대기 중 <!-- leerness:auto -->
- 개발 저장소 `gugu9999gu/How-much-is-tokens`는 Private, `gugu9999gu/How-much-is-tokens-releases`는 Public 바이너리 배포 전용으로 운영 중.
- Leerness v1.36.184를 고정 설치하고 Windows CI에서 `leerness gate`를 필수 검증으로 실행함.
- OpenRouter API/Management Key는 `openrouterProfile:<id>:...` 단위로 Electron safeStorage에 암호화 저장하며 기존 단일 key는 `default` 프로필로 호환함.
- OpenRouter 프로필별 usage/credit 카드와 우선순위 메타데이터를 지원함.
- localhost API Router는 `127.0.0.1`에만 bind하고 OpenAI-compatible `/v1` 요청을 OpenRouter `https://openrouter.ai/api/v1`로 전달함.
- 로컬 클라이언트 인증은 OpenRouter 원본 키와 별도인 CSPRNG Bearer token을 사용하며 원문은 safeStorage에만 저장하고 renderer에는 반환하지 않음.
- client `Authorization`, `x-api-key`, `api-key`, OpenAI key 계열, cookie 등 credential성 헤더는 upstream에 전달하지 않고 선택된 OpenRouter API Key로 Authorization을 교체함.
- key 선택은 `priority-fallback` 또는 `max-remaining`; 401/402/403/429는 응답 commit 전 cooldown/failover하며 모든 key가 불가하면 503 fail-closed.
- network failure는 key를 cooldown하되 GET/HEAD/OPTIONS만 다음 key로 재시도하고, POST 등 비멱등 요청은 upstream 처리 여부가 불명확하므로 502로 중단하고 자동 replay하지 않음.
- upstream 응답을 client에 전달하기 시작한 뒤 stream 실패 시 다른 key로 요청을 replay하지 않음.
- PR #26 Windows CI run `33981095152`, main post-merge CI run `33981334811`, public release run `33981622986`이 모두 성공함.
- Public v1.0.24 Release 자산: `How-much-is-tokens-1.0.24-portable.exe`, `SHA256SUMS.txt`; EXE SHA-256 `d0397fc8e158559f333d0c5b4b2329646a36825021c656c831104d8794a10211`.
- 배포를 위해 사용한 one-time dispatcher workflow는 main에서 제거함.

## Next
- 계획된 작업 없음 <!-- leerness:auto -->
- 새 기능 작업 시 기존 secure profile/loopback/no-replay 경계를 깨지 않도록 회귀 테스트부터 갱신.
- 모든 개발 세션은 시작 시 handoff, 완료 전 gate, 종료 시 session close 절차를 사용.

## Blockers
- (없음) <!-- leerness:auto -->
- 구현/배포 권한 관련 현재 blocker 없음.
