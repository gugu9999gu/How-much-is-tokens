const fs = require("fs");

const mainPath = "main.js";
let main = fs.readFileSync(mainPath, "utf8");
const integration = 'require("./lib/openrouter-main-integration");';
if (!main.includes(integration)) {
  const anchor = 'const { loadSettings, saveSettings, resetSettings } = require("./lib/settings");';
  if (!main.includes(anchor)) throw new Error("main.js integration anchor not found");
  main = main.replace(anchor, `${anchor}\n${integration}`);
  fs.writeFileSync(mainPath, main, "utf8");
}

const htmlPath = "renderer/index.html";
let html = fs.readFileSync(htmlPath, "utf8");
const pattern = /          <div class="set-group api-provider-group">[\s\S]*?(?=          <div class="set-group">\r?\n            <h2>연결<\/h2>)/;
const replacement = `          <div class="set-group api-provider-group">
            <h2>API 공급자</h2>
            <label class="toggle edge-toggle">
              <span class="toggle-copy">
                <b>OpenRouter</b>
                <small>다중 API Key 사용량·크레딧·localhost 요청 라우팅</small>
              </span>
              <input type="checkbox" id="openRouterEnabled" />
              <span class="switch" aria-hidden="true"></span>
            </label>
            <div class="api-provider-fields">
              <div class="openrouter-profile-editor">
                <label class="field">
                  <span class="field-label">키 프로필</span>
                  <textarea id="openRouterProfiles" rows="4" placeholder="primary|주 키|10|on&#10;backup|백업 키|20|on" spellcheck="false"></textarea>
                  <small>한 줄에 <b>id|표시 이름|우선순위|on/off</b>. id는 영문 소문자/숫자/underscore/hyphen, 최대 16개. 키 원문은 여기에 저장하지 않습니다.</small>
                </label>
                <div class="openrouter-profile-actions">
                  <button type="button" id="saveOpenRouterProfiles" class="btn primary">프로필 목록 저장</button>
                  <select id="openRouterProfileSelect" aria-label="OpenRouter 키 편집 프로필"></select>
                </div>
              </div>
              <label class="field">
                <span class="field-label">선택 프로필 API Key</span>
                <input class="secret-input" type="password" id="openRouterApiKey" placeholder="OpenRouter API Key" autocomplete="off" spellcheck="false" />
                <small id="openRouterApiKeyStatus">선택 프로필의 요청/사용량 조회와 localhost 라우팅에 사용합니다.</small>
              </label>
              <label class="field">
                <span class="field-label">Management Key <em>선택</em></span>
                <input class="secret-input" type="password" id="openRouterManagementKey" placeholder="계정 크레딧 조회용" autocomplete="off" spellcheck="false" />
                <small id="openRouterManagementKeyStatus">계정의 총 충전 크레딧과 실제 남은 크레딧을 조회할 때 필요합니다.</small>
              </label>
              <div class="api-secret-actions">
                <button type="button" id="saveOpenRouterKeys" class="btn primary">OpenRouter 키 저장</button>
                <button type="button" id="clearOpenRouterKeys" class="btn subtle-danger">선택 프로필 키 삭제</button>
              </div>
              <p id="openRouterSecureStatus" class="security-note">키 원문과 localhost 인증 토큰은 settings.json에 저장하지 않습니다.</p>

              <div class="openrouter-router-card">
                <label class="toggle">
                  <span class="toggle-copy">
                    <b>localhost API Router</b>
                    <small>OpenAI-compatible 요청을 127.0.0.1에서 받아 사용 가능한 OpenRouter 키로 전송</small>
                  </span>
                  <input type="checkbox" id="openRouterRouterEnabled" />
                  <span class="switch" aria-hidden="true"></span>
                </label>
                <div class="openrouter-router-grid">
                  <label class="field">
                    <span class="field-label">포트</span>
                    <input type="number" id="openRouterRouterPort" min="1024" max="65535" value="43123" />
                  </label>
                  <label class="field">
                    <span class="field-label">키 선택 정책</span>
                    <select id="openRouterRouterPolicy">
                      <option value="priority-fallback">우선순위 fallback</option>
                      <option value="max-remaining">잔여량 최대</option>
                    </select>
                  </label>
                </div>
                <p class="openrouter-router-endpoint" id="openRouterRouterEndpoint">http://127.0.0.1:43123/v1</p>
                <button type="button" id="copyOpenRouterRouterToken" class="btn primary">로컬 Bearer 토큰 복사</button>
                <p id="openRouterRouterStatus" class="security-note">라우터 꺼짐 · 활성화하면 127.0.0.1에만 바인딩합니다.</p>
              </div>
            </div>
          </div>

`;
if (!pattern.test(html)) throw new Error("OpenRouter settings block replacement anchor not found");
html = html.replace(pattern, replacement);
fs.writeFileSync(htmlPath, html, "utf8");
