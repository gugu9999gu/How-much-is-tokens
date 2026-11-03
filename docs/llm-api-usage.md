# GPT / Claude API 사용량 및 크레딧 표시

## 연결 방법

1. 위젯 설정 → **API 키 등록** → **AI API 키·크레딧**으로 이동합니다.
2. **OpenAI API (GPT)** 또는 **Anthropic API (Claude)**에서 **+ API 계정**을 선택합니다.
3. 표시 이름과 조직 **Admin API Key**(Anthropic Enterprise의 경우 Analytics API Key)를 입력합니다.
4. **Tracking ID · API Key ID** (`key_...` / `apikey_...`)를 입력합니다. 이 값은 API 키의 **식별자**이며 모델 호출용 비밀 키(`sk-...`)와 다릅니다. 비워두면 조직 전체를 조회합니다.
5. **월 사용 예산(USD)**을 선택적으로 설정합니다. 예: 50.00. 이 값은 사용자 지정 목표값이며 공급자 계정의 실제 잔액·과금 상한이 아닙니다.
6. **추가하고 추적**을 누르면 API 자격증명과 Tracking ID는 OS 보안 저장소에 암호화되고, 예산 설정만 일반 설정 파일에 기록됩니다. 서로 다른 Tracking ID는 별도 카드로 표시됩니다.

하나의 조직 관리자 키로 서로 다른 Tracking ID 프로필을 여러 개 등록할 수 있지만, 각 프로필의 관리자 키는 입력해야 합니다. 이미 만든 프로필은 **키 편집 → 설정 저장**에서 관리자 키를 다시 입력하지 않고 월 예산을 수정하거나 비울 수 있습니다.

상단의 **기본 연결 · 기존 API Key** 경로도 기존 사용자와의 호환을 위해 유지됩니다. 자격증명은 `settings.json` 또는 렌더러 사용량 데이터에 포함되지 않으며 Electron `safeStorage`로 암호화됩니다. 운영체제가 암호화를 제공하지 않으면 저장이 거부됩니다.

## 표시 데이터

| 서비스 | 월간 비용 | 토큰 사용량 | 크레딧 잔액 | 인증 |
| --- | --- | --- | --- | --- |
| OpenAI API | 조직 비용 API (USD) | Completions 사용량 API의 입력+출력 토큰 | 공식 잔액 조회 API 없음 · Billing 화면에서 확인 | 조직 Admin API Key |
| Anthropic API | Analytics Cost API (센트 → USD) | Analytics Usage API의 총 토큰·요청 수 | 공식 잔액 조회 API 없음 · Console Billing에서 확인 | Console Admin API Key 또는 Enterprise `read:analytics` Key |
| OpenRouter | 기존 API Key/Management Key 연동 | 누적/일간/월간 사용 금액 등 | 공식 크레딧 API로 조회 가능한 범위 | API Key와 선택적 Management Key |
| fal.ai·Stability·ElevenLabs 외 | 각 서비스가 제공하는 항목 | 각 서비스가 제공하는 항목 | API 제공 시 조회 | 공급자별 Key |

- **API 비용은 이미 사용한 금액이지 남은 크레딧이 아닙니다.** `used` 필드로 표시하여 가짜 `잔여 $0`을 만들지 않습니다.
- **월 예산 잔여(계산)** = max(0, 사용자가 설정한 월 예산 USD − 조회된 이번 달 해당 Tracking ID 비용 USD). 초과 사용 시 초과 금액을 별도 표시합니다. 이는 **실제 선불 크레딧 잔액이 아닙니다.**
- 비용 조회에 실패하거나 페이지가 불완전할 때는 예산 잔여액을 계산하지 않습니다. Tracking ID가 비어 있으면 전체 조직 기준 예산으로 계산됩니다.
- API Key ID는 비용·토큰 API에 필터로 전달되며 인증 자격증명은 반드시 조직 관리자/분석 키를 사용합니다. Tracking ID만으로 조회할 수 없습니다.
- 조회 기간은 **이번 달 1일 00:00 UTC ~ 조회 시각**입니다. 완료된 모든 페이지를 합산하며 실패한 페이지가 있으면 불완전한 합계를 표시하지 않습니다.
- OpenAI 토큰은 조직의 **Completions** 사용량만 포함합니다. 비용은 조직의 전체 비용 집계일 수 있어 두 수치가 정확히 비례하지 않습니다.
- Anthropic Analytics API는 베타이며 공식 문서상 데이터 반영은 일반적으로 요청 완료 후 약 5분 이내지만, 추가 지연이 발생할 수 있습니다. 표시되는 데이터 갱신 시각을 확인하세요.
- 관리자 키가 없거나 권한이 부족한 경우 **권한 필요** 상태로 표시하며, ChatGPT/Claude 웹 구독 한도와 API 계정 결제는 혼합하지 않습니다.
- 잔액 조회를 지원하지 않는 공급자에 대해 앱이 요청을 발생시켜 비용을 소모하거나 남은 잔액을 역산하지 않습니다.

## 공식 자료
- OpenAI Organization Costs: https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs
- OpenAI Organization Completions Usage: https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/completions
- OpenAI API Usage Dashboard/Billing: https://help.openai.com/en/articles/10478918-reviewing-api-usage-and-costs
- Anthropic Usage and Cost Analytics API: https://platform.claude.com/docs/en/manage-claude/usage-cost-analytics-api
