# GPT / Claude API 사용량 및 크레딧 표시

## 연결 방법

1. 위젯 설정 → **API 키 등록** → **AI API 키·크레딧**으로 이동합니다.
2. **OpenAI API (GPT)** 또는 **Anthropic API (Claude)**에서 **+ API 계정**을 선택합니다.
3. 표시 이름과 조직 **Admin API Key**(Anthropic Enterprise의 경우 Analytics API Key)를 입력합니다.
4. 한 API 키에만 귀속된 사용량을 보려면 **조회 대상 API Key ID**(비밀 API 키 값이 아닌 `key_...` / `apikey_...` 형태의 식별자)를 함께 입력합니다. ID 미입력 시 조직 전체의 집계를 조회합니다.
5. **추가하고 추적**을 누르면 안전한 저장소에 암호화되어 다음 새로고침부터 카드에 표시됩니다. 같은 공급자에 여러 API 계정을 등록할 수 있습니다.

상단의 **기본 연결 · 기존 API Key** 경로도 기존 사용자와의 호환을 위해 유지됩니다. 자격증명은 `settings.json` 또는 렌더러 사용량 데이터에 포함되지 않으며 Electron `safeStorage`로 암호화됩니다. 운영체제가 암호화를 제공하지 않으면 저장이 거부됩니다.

## 표시 데이터

| 서비스 | 월간 비용 | 토큰 사용량 | 크레딧 잔액 | 인증 |
| --- | --- | --- | --- | --- |
| OpenAI API | 조직 비용 API (USD) | Completions 사용량 API의 입력+출력 토큰 | 공식 잔액 조회 API 없음 · Billing 화면에서 확인 | 조직 Admin API Key |
| Anthropic API | Analytics Cost API (센트 → USD) | Analytics Usage API의 총 토큰·요청 수 | 공식 잔액 조회 API 없음 · Console Billing에서 확인 | Console Admin API Key 또는 Enterprise `read:analytics` Key |
| OpenRouter | 기존 API Key/Management Key 연동 | 누적/일간/월간 사용 금액 등 | 공식 크레딧 API로 조회 가능한 범위 | API Key와 선택적 Management Key |
| fal.ai·Stability·ElevenLabs 외 | 각 서비스가 제공하는 항목 | 각 서비스가 제공하는 항목 | API 제공 시 조회 | 공급자별 Key |

- **API 비용은 이미 사용한 금액이지 남은 크레딧이 아닙니다.** `used` 필드로 표시하여 가짜 `잔여 $0`을 만들지 않습니다.
- 조회 기간은 **이번 달 1일 00:00 UTC ~ 조회 시각**입니다. 완료된 모든 페이지를 합산하며 실패한 페이지가 있으면 불완전한 합계를 표시하지 않습니다.
- OpenAI 토큰은 조직의 **Completions** 사용량만 포함합니다. 비용은 조직의 전체 비용 집계일 수 있어 두 수치가 정확히 비례하지 않습니다.
- Anthropic Analytics API는 베타이며 공식 문서상 데이터 반영이 일반적으로 수 시간 지연되며 **최대 24시간** 지연될 수 있습니다. 표시되는 데이터 갱신 시각을 확인하세요.
- 관리자 키가 없거나 권한이 부족한 경우 **권한 필요** 상태로 표시하며, ChatGPT/Claude 웹 구독 한도와 API 계정 결제는 혼합하지 않습니다.
- 잔액 조회를 지원하지 않는 공급자에 대해 앱이 요청을 발생시켜 비용을 소모하거나 남은 잔액을 역산하지 않습니다.

## 공식 자료
- OpenAI Organization Costs: https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs
- OpenAI Organization Completions Usage: https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/completions
- OpenAI API Usage Dashboard/Billing: https://help.openai.com/en/articles/10478918-reviewing-api-usage-and-costs
- Anthropic Usage and Cost Analytics API: https://platform.claude.com/docs/en/manage-claude/usage-cost-analytics-api
