const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "renderer", "assets", "platform-logos");
const UA = { "user-agent": "Mozilla/5.0" };

function addXmlns(svg) {
  return /xmlns=/.test(svg)
    ? svg
    : svg.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
}

async function getText(url) {
  const response = await fetch(url, {
    headers: UA,
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.text();
}

async function saveDirect(name, url) {
  const svg = await getText(url);
  if (!/^\s*(<\?xml[\s\S]*?\?>\s*)?<svg\b/i.test(svg)) {
    throw new Error(`${name}: expected SVG from ${url}`);
  }
  fs.writeFileSync(path.join(OUT, `${name}.svg`), svg);
  console.log(`${name}: ${url}`);
}

async function saveInline(name, url, findSvg) {
  const html = await getText(url);
  const svg = findSvg(html);
  if (!svg) throw new Error(`${name}: inline SVG not found at ${url}`);
  fs.writeFileSync(path.join(OUT, `${name}.svg`), addXmlns(svg));
  console.log(`${name}: inline SVG from ${url}`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  await saveDirect("grok", "https://grok.com/images/favicon.svg");
  await saveDirect("cursor", "https://cursor.com/favicon.svg");
  await saveDirect("github", "https://github.githubassets.com/favicons/favicon.svg");
  await saveDirect("openrouter", "https://openrouter.ai/brand/v2/openrouter-glyph-light.svg");
  await saveDirect("higgsfield", "https://higgsfield.ai/home/higgsfield-projects/higgs-icon.svg");
  await saveDirect("magnific", "https://media.magnific.com/magnific-favicons/favicon.svg?v=2");
  await saveDirect("elevenlabs", "https://elevenlabs.io/icon.svg?c23f5371fdd26632");

  await saveInline("anthropic", "https://www.anthropic.com/", (html) => {
    const match = html.match(/<a[^>]*aria-label="Home Page"[^>]*>\s*(<svg\b[\s\S]*?<\/svg>)\s*<\/a>/i);
    return match && match[1];
  });

  await saveInline("antigravity", "https://www.agy.dev/", (html) => {
    const match = html.match(/(<svg\b[^>]*class="[^"]*\blogo\b[^"]*"[^>]*>[\s\S]*?<\/svg>)/i);
    return match && match[1];
  });

  await saveInline("falai", "https://fal.ai/", (html) => {
    const svgs = [...html.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)].map((match) => match[0]);
    return svgs.find((svg) => /viewBox="0 0 120 48"/i.test(svg));
  });

  console.log("OpenAI is extracted separately from the official OpenAI-Logos-2025.zip package.");
  console.log("Stability AI is intentionally not bundled because its current Terms require prior written permission for logo use.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
