---
leernessRole: plan
readWhen:
  - 작업 시작 전
  - 새 요청 접수
  - 범위 변경
  - 신규 프로젝트 감지
updateWhen:
  - 계획 추가/수정/드랍
  - milestone 변경
  - 목표 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Plan

## Goal
- Windows 데스크톱에서 AI 서비스별 구독 quota·크레딧·잔액을 정확히 표시하고, 사용자가 명시적으로 등록한 다계정/API 키를 안전하게 선택·전환할 수 있는 위젯을 유지한다.
- 인증정보 원문은 가능한 경우 OS 보안 저장소에만 보관하고, 자동 라우팅은 보수적으로 fail-closed 하며 검증 가능한 CI 증거를 남긴다.

## Scope
- Claude, Codex/ChatGPT, Cursor, Copilot, Grok/Grok Bot, Antigravity, OpenRouter의 실제 upstream usage/quota/credit 정보 표시.
- CLI 계정 프로필과 API 키 프로필을 서로 격리하고 계정별 상태/캐시를 분리.
- OpenRouter API 키 프로필의 Electron safeStorage 암호화 저장, 사용량 카드, localhost OpenAI-compatible 요청 라우팅.
- Windows CI의 회귀 테스트, Leerness gate, secure-storage/renderer/Antigravity smoke, portable EXE build.
- Private 개발 저장소와 Public 바이너리 Release 저장소의 분리 배포.

## Out of Scope / Dropped
| ID | Item | Reason | Date |
|---|---|---|---|
| OOS-0001 | ChatGPT/Codex 구독 로그인 정보를 일반 OpenAI/OpenRouter API Key처럼 사용 | 구독/CLI 인증과 API 자격증명은 별도 보안·과금 표면이며 투명 변환하지 않음 | 2026-09-06 |
| OOS-0002 | localhost 라우터를 LAN/WAN 인터페이스에 공개 | 자격증명 프록시 공격면을 늘리므로 127.0.0.1 전용 유지 | 2026-09-06 |
| OOS-0003 | 스트리밍 응답 전달 시작 후 다른 API Key로 요청 재전송 | 중복 과금·중복 side effect 위험 때문에 금지 | 2026-09-06 |

## Milestones

### M-0001. 개발/배포 저장소 및 Leerness 운영 경계 구축
Status: done
Progress: 100%

Tasks:
- [x] 개발 저장소를 Private으로 운영
- [x] Public `How-much-is-tokens-releases` 바이너리 배포 저장소 분리
- [x] `RELEASE_REPO_TOKEN` cross-repository read/write 실제 검증
- [x] Leerness v1.36.184 설치 및 Windows CI gate 연동
- [x] v1.0.23 portable EXE/체크섬 공개 배포 경로 검증

### M-0002. v1.0.24 OpenRouter secure multi-key localhost router
Status: done
Progress: 100%

Tasks:
- [x] OpenRouter API/Management Key를 프로필별 safeStorage 암호문으로 격리
- [x] 기존 단일 OpenRouter key를 `default` 프로필로 호환/이전
- [x] 프로필별 usage/credit 카드 표시
- [x] 127.0.0.1 전용 OpenAI-compatible `/v1` request router 구현
- [x] 별도 로컬 Bearer 인증 토큰 및 client credential 헤더 비전달
- [x] priority fallback / max remaining 정책, 401/402/403/429 cooldown/failover, 503 fail-closed 구현
- [x] 비멱등 POST network failure의 502/no-replay 및 안전 메서드 network failover 구현
- [x] 응답 commit 이후 streaming replay 금지
- [x] unit/security/DPAPI/renderer 사전 검증
- [x] PR #26 정식 Windows CI 및 portable EXE build 통과
- [x] main squash merge 및 post-merge Windows CI 통과
- [x] Public v1.0.24 Release에 portable EXE/`SHA256SUMS.txt`/명시적 공개 노트만 게시
