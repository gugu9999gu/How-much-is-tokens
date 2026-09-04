---
leernessRole: session-workflow
readWhen:
  - 세션 시작
  - 새 사용자 요청 도착
  - 복잡한 작업 분배 전
updateWhen:
  - 워크플로 단계 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Session Workflow — AI 하네스 엔지니어링 6단계

> **매 세션 시작 시 메인 에이전트는 이 문서를 먼저 읽고 6단계를 그대로 따른다.**
> 라운드 길이/복잡도 무관, 단순 작업도 동일 흐름 유지 — 그래야 drift 안 됨.

## Step 1. 요청 분석 + 환경 확인
```bash
leerness handoff .            # 컨텍스트 적재 + drift 자동 경고
leerness drift check .        # 4 신호 + 4단계 레벨
```
- 사용자 요청을 5W1H로 분해. 모호하면 명확화 질문 (autonomous 모드 제외).
- drift critical 시 `leerness session close .` 또는 `drift check --auto-fix` 우선 실행.
- **버그 수정 요청이면 코드를 고치기 전에 재현부터**: `leerness bugfix start <T-ID> --repro "<재현 명령>" --expect-bad "<실패 신호>"`
  → 지금 실패하는 probe 를 먼저 등록해야, 나중에 "고쳤다"가 **증상만 덮은 것인지** 구분된다. 수정 후엔
  `leerness bugfix receipt <T-ID> --root-cause "..." --siblings "같은 원인이 걸린 다른 지점들"` 로 근본원인과 형제 범위를 남긴다.
  (완료 게이트는 옵트인: `leerness toggle set bugfix-receipt on`)

## Step 2. 계획 수립
- 작업이 3 step 이상 → TodoWrite 또는 `leerness plan add` 사용.
- 신규 capability → `leerness reuse-map` / `reuse find <query>`로 기존 자원 우선 검색.
- 다중 모듈 → 통합 사양 사전 정의 (예: TICK_SPEC.md).

## Step 3. 업무 분배 — sub-agent 매핑
```bash
leerness agents list                  # ready CLI 확인
leerness agents quota                 # 한도 확인
leerness agents dispatch "<task>" --to <id>   # 작업 유형 추천 자동
```
- 작업 유형별 기본 sub-agent 매핑 (leerness 의 **기본 관례**이며 측정된 성능·품질 순위가 아닙니다):
  - 텍스트/번역/분석 → claude
  - 깊은 코드 추론 → codex
  - 파일 직접 수정 → agy --yolo (Antigravity CLI)
  - 보안 리뷰 → `leerness review --persona security`
- **충돌 방지 규칙 (필수)**:
  - 각 sub-agent에 *자신만 수정할 파일 경로* 명시
  - mtime 검증 결과 보고 의무화 (동시 쓰기는 last-writer-wins 위험)
  - 사양 사전 정의 → `leerness contract verify`로 사후 검증

## Step 4. sub-agent 작업 + 개별 자체 검증
- 각 sub-agent가 자기 모듈 자체 테스트 통과 후 보고.
- 보고 형식: 라인 수, 테스트 N/N PASS, 발견 이슈, mtime 검증 결과.

## Step 5. 종합 검증
```bash
leerness contract verify SPEC.md src/<mod>.js  # 명세 ↔ 구현 일치
leerness verify-claim T-XXX --run-tests --strict-claims
leerness review <file> --persona security,performance,ux
```
- 메인이 직접 통합 시나리오 작성 + 실행 (independent 검증).
- Sub-agent 검수 vs 메인 검수 결과 *교차 일치* 확인.

## Step 6. 세션 마감 + 인계 + 다음 라운드 추천
```bash
leerness session close .             # --suggest default 활성 (마감 + 다음 라운드 자동)
leerness session close . --no-suggest  # suggest 비활성 (이전 동작)

# 분리 호출도 가능:
leerness skill suggest .             # 반복 패턴 → 새 skill 후보
leerness drift check .               # 4 신호 + 4 레벨 점검
leerness audit . --fix               # 누락 메타 자동 보강
```

## 🧠 Memory CRUD Quick Reference

5 Memory Surface 모두 CRUD CLI + MCP 노출 완성:

| Surface | CREATE | READ | DELETE | RESTORE |
|---|---|---|---|---|
| **tasks** | task add | task list --json | task drop | task update |
| **decisions** | decision add | decision list --json | decision drop | memory restore decisions |
| **lessons** | lesson save | lesson list [--tag] | lesson drop | memory restore lessons |
| **plan** | plan add | plan list --json | plan remove | memory restore plan |
| **rules** | rule add | rule list --json | rule remove | (rule pause/resume) |

```bash
leerness memory status [--json]              # 5종 상태 통합 조회 (T/D/R/P/L 카운트)
leerness memory archive list [--surface s]   # DELETE archive 통합 조회 (복원 후보)
leerness memory restore <surface> <target>   # archive → active 복귀 (DELETE→RESTORE cycle)
```

**잘못 저장한 항목 복구**:
1. `memory archive list` — 복원 후보 확인
2. `memory restore decisions "PostgreSQL"` — archive → active
3. handoff 가 매 세션 자동으로 24h 내 archive 활동 알림


## 자동 회복 · 보안

- session close가 누락되면 다음 세션 시작 시 drift critical 발생.
- 자동 회복 옵션: `drift check --auto-fix` (critical 시 session close 자동 실행).
- handoff가 매 세션 시작 시 **과거 lessons 자동 재상기** (현재 task 키워드 기준).
- handoff가 현재 task와 매칭되는 **설치된 skill을 자동 추천** (jaccard 기반, default ON, `--no-skill-suggest`로 끄기).
- lessons 인덱스에 `task-log.md` 실패 라인까지 포함 → 회수 범위 확장.
- handoff가 `skill-suggestions.md` rolling history (과거 같은 키워드 매칭 결과)도 자동 노출.
- handoff에 보안 요약 1~2 line 자동 (`.env` ↔ `.env.example` 동기화 + `.gitignore` 시크릿 누락).
- `.env` 가 `.gitignore` 에 누락 시 🚨 CRITICAL + `LEERNESS_AUTO_SECURITY_FIX=1` 환경변수 시 `audit --fix` 자동 실행.
- handoff Date/Project 직후 통합 헤드라인 한 줄 (drift / 보안 / MCP / skill query / 설치 skill 수).
- `leerness health` 한 줄로 종합 점검 (drift + 보안 + skills + usage + tasks).
- `leerness drift check --auto-fix` 가 보안 신호 발견 시 `audit --fix` 자동 실행 → 재검사.

---

## 빠른 체크리스트

세션 끝나기 전 다음이 모두 ✓이어야 한다:
- [ ] plan/progress-tracker에 이번 라운드 task 등록됨 (또는 task sync)
- [ ] 모든 done 항목에 evidence 첨부됨 (verify-claim PASS)
- [ ] sub-agent 사용 시 contract verify PASS
- [ ] drift 점수 ≤ 30 (attention 이하) — `leerness drift check` (5신호 + 보안)
- [ ] session close 호출됨
- [ ] `leerness health`로 종합 점검 — drift + 보안 + skill + MCP + tasks
- [ ] `.env` 사용 중이면 `.gitignore` 시크릿 패턴 OK + `.env.example` 동기화
- [ ] 보안 critical 시 `LEERNESS_AUTO_SECURITY_FIX=1` 또는 `audit --fix`로 자동 회복

## Anti-pattern (drift 신호)

- ⚠ "작업 끝났으니 보고만 하고 끝" → session close 누락 → 다음 세션 drift critical
- ⚠ "TodoWrite만 갱신하고 leerness 안 씀" → `task sync --from` 또는 `task add` 필수
- ⚠ sub-agent 분배 시 파일 경로 미명시 → 동시 쓰기 충돌
- ⚠ "테스트 돌렸으니 PASS" 자기 보고만 → verify-claim --run-tests 미실행
- ⚠ contract verify 생략 → 사양 불일치 BUG가 사용자에게 노출
