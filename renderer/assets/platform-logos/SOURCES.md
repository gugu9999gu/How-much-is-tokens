# Platform logo asset sources

Retrieved on 2026-09-11 for the How much is tokens provider-identification UI. These assets remain trademarks of their respective owners. Inclusion is for identifying the service shown by the quota widget and does not imply sponsorship, affiliation, or endorsement. SVG artwork is kept as supplied by the source; when an inline SVG lacked an `xmlns` declaration, that declaration alone was added so it can be loaded as a standalone image.

| Local asset | Provider rows | Source | Retrieval |
| --- | --- | --- | --- |
| `openai.svg` | Codex / OpenAI | `https://cdn.openai.com/brand/OpenAI-Logos-2025.zip` | Official OpenAI brand package, member `OpenAI-logos(new)/SVGs/OpenAI-black-monoblossom.svg` |
| `anthropic.svg` | Claude / Anthropic | `https://www.anthropic.com/` | Official homepage navigation logo, extracted from the inline SVG inside the Home link |
| `antigravity.svg` | Google Antigravity | `https://www.agy.dev/` | Official Antigravity homepage logo, extracted from its inline SVG |
| `grok.svg` | Grok / Grokbot | `https://grok.com/images/favicon.svg` | Official Grok SVG favicon |
| `cursor.svg` | Cursor | `https://cursor.com/favicon.svg` | Official Cursor SVG favicon |
| `github.svg` | GitHub Copilot | `https://github.githubassets.com/favicons/favicon.svg` | Official GitHub mark used to identify the GitHub product row |
| `openrouter.svg` | OpenRouter | `https://openrouter.ai/brand/v2/openrouter-glyph-light.svg` | Current OpenRouter v2 brand glyph |
| `falai.svg` | fal.ai | `https://fal.ai/` | Official homepage logo, extracted from the inline `viewBox="0 0 120 48"` SVG |
| `higgsfield.svg` | Higgsfield | `https://higgsfield.ai/home/higgsfield-projects/higgs-icon.svg` | Official Higgsfield site SVG asset |
| `magnific.svg` | Magnific | `https://media.magnific.com/magnific-favicons/favicon.svg?v=2` | Official Magnific SVG favicon referenced by the site |
| `elevenlabs.svg` | ElevenLabs | `https://elevenlabs.io/icon.svg?c23f5371fdd26632` | Official ElevenLabs SVG icon referenced by the site |

## Stability AI

No `stability.svg` is bundled. Stability AI's current Terms of Service state that Stability names, logos, and trademarks may not be used without prior written permission. The widget therefore uses a neutral `S` fallback tile for the Stability provider instead of redistributing an official or third-party logo file. If written permission is obtained, an approved asset can be added to this directory and mapped in `renderer/app.js`.

## Refresh helper

`tools/refresh-platform-logos.js` re-fetches the direct SVG endpoints and re-extracts the official homepage inline SVGs used above. OpenAI is intentionally handled from its official ZIP package rather than by scraping another copy of the mark.
