const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "publish-public-release.yml"), "utf8");
const splitDoc = fs.readFileSync(path.join(root, "docs", "repository-split.md"), "utf8");
const agents = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));

const expectedLeerness = "github:gugu9999gu/leerness#7204fe45dcdeaf51ae932510a5cca43aeb3eb978";
assert.strictEqual(pkg.devDependencies.leerness, expectedLeerness, "Leerness must stay pinned to the reviewed source commit");
assert.strictEqual(lock.packages[""].devDependencies.leerness, expectedLeerness, "package-lock must pin the same Leerness source");
assert.ok(fs.existsSync(path.join(root, ".leerness", "HARNESS_VERSION")), "Leerness workspace must be committed");
assert.ok(fs.existsSync(path.join(root, ".leerness", "current-state.md")), "Leerness current state must be available to development agents");

assert.ok(agents.includes("npm run leerness:handoff"), "development agents must load Leerness handoff at session start");
assert.ok(agents.includes("npm run leerness:close"), "development agents must close the Leerness session before handoff");
assert.ok(pkg.scripts["leerness:gate"], "Leerness evidence gate script must exist");
assert.ok(pkg.scripts["leerness:close"].includes("session close"), "session close must use the current Leerness session workflow");

assert.ok(workflow.includes("RELEASE_REPO: gugu9999gu/How-much-is-tokens-releases"));
assert.ok(workflow.includes("secrets.RELEASE_REPO_TOKEN"), "cross-repository publishing must use a dedicated secret");
assert.ok(workflow.includes("dist\\SHA256SUMS.txt"), "public release must include a checksum");
assert.ok(workflow.includes("$env:ARTIFACT_PATH"), "public release must upload the built portable executable");
assert.ok(workflow.includes("docs\\public-release-notes\\v$env:VERSION.md"), "only explicitly public release notes may cross the repository boundary");
assert.ok(!workflow.includes("docs\\v$env:VERSION.md"), "private development release notes must never be auto-published");
assert.ok(!/gh\s+repo\s+clone/i.test(workflow), "release workflow must not clone/mirror the public repository source tree");
assert.ok(!/git\s+push/i.test(workflow), "release workflow must not push the private development Git history to the public repository");
assert.ok(!/\.leerness[^\n]*upload/i.test(workflow), "Leerness development state must never be uploaded as a public release asset");

assert.ok(splitDoc.includes("Change repository visibility"), "one-time private visibility operation must be documented");
assert.ok(splitDoc.includes("How-much-is-tokens-releases"), "public release repository name must be documented");
assert.ok(splitDoc.includes("RELEASE_REPO_TOKEN"), "cross-repository credential setup must be documented");

console.log("private development / public release / Leerness boundary tests passed");
