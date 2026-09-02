const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  EDGE_SIDES,
  getDockGeometry,
  pointInRect,
  maxWidgetHeight,
  clampNormalBounds,
  interpolateBounds,
} = require("../lib/edge-dock");
const {
  DEFAULTS,
  EDGE_DOCK_SIDES,
  TOKEN_AREA_MIN_HEIGHT,
  TOKEN_AREA_MAX_HEIGHT,
  normalizeTokenAreaMaxHeight,
  normalizeSettings,
} = require("../lib/settings");

assert.deepStrictEqual(EDGE_SIDES, ["top", "right", "bottom", "left"]);
assert.deepStrictEqual(EDGE_DOCK_SIDES, ["top", "right", "bottom", "left"]);
assert.strictEqual(DEFAULTS.edgeDockEnabled, false);
assert.strictEqual(DEFAULTS.edgeDockSide, "right");
assert.strictEqual(DEFAULTS.denseLayout, false);
assert.strictEqual(DEFAULTS.tokenAreaMaxHeight, 0);
assert.strictEqual(TOKEN_AREA_MIN_HEIGHT, 120);
assert.strictEqual(TOKEN_AREA_MAX_HEIGHT, 2000);
assert.strictEqual(normalizeTokenAreaMaxHeight(0), 0);
assert.strictEqual(normalizeTokenAreaMaxHeight(-10), 0);
assert.strictEqual(normalizeTokenAreaMaxHeight(40), 120);
assert.strictEqual(normalizeTokenAreaMaxHeight(500), 500);
assert.strictEqual(normalizeTokenAreaMaxHeight(9000), 2000);
assert.strictEqual(normalizeSettings({ edgeDockEnabled: true, edgeDockSide: "bottom", denseLayout: true }).edgeDockSide, "bottom");
assert.strictEqual(normalizeSettings({ edgeDockSide: "diagonal" }).edgeDockSide, "right");
assert.strictEqual(normalizeSettings({ tokenAreaMaxHeight: 520 }).tokenAreaMaxHeight, 520);

const display = {
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
};
const size = { width: 332, height: 600 };
const anchor = { x: 1200, y: 140 };

const right = getDockGeometry(display, size, "right", anchor);
assert.strictEqual(right.shown.x, 1582);
assert.strictEqual(right.shown.y, 140);
assert.strictEqual(right.hidden.x, 1917);
assert.strictEqual(right.trigger.x, 1910);
assert.ok(pointInRect({ x: 1919, y: 200 }, right.trigger));
assert.ok(!pointInRect({ x: 1000, y: 200 }, right.trigger));

const top = getDockGeometry(display, size, "top", anchor);
assert.strictEqual(top.shown.y, 6);
assert.strictEqual(top.hidden.y, -597);
assert.strictEqual(top.trigger.y, 0);
assert.ok(pointInRect({ x: top.shown.x + 30, y: 2 }, top.trigger));

const bottom = getDockGeometry(display, size, "bottom", anchor);
assert.strictEqual(bottom.shown.y, 434);
assert.strictEqual(bottom.hidden.y, 1077);
assert.strictEqual(bottom.trigger.y, 1070);

// Repeated side changes must always derive a fully visible shown rectangle
// from the same stable anchor, not from the previous side's hidden position.
for (const side of ["top", "right", "bottom", "left", "top", "bottom", "right"]) {
  const geometry = getDockGeometry(display, size, side, anchor);
  assert.ok(geometry.shown.x >= display.workArea.x, `${side}: shown x escaped work area`);
  assert.ok(geometry.shown.y >= display.workArea.y, `${side}: shown y escaped work area`);
  assert.ok(geometry.shown.x + geometry.shown.width <= display.workArea.x + display.workArea.width, `${side}: shown width escaped work area`);
  assert.ok(geometry.shown.y + geometry.shown.height <= display.workArea.y + display.workArea.height, `${side}: shown height escaped work area`);
}

assert.strictEqual(maxWidgetHeight(display.workArea, 10), 1020);
assert.deepStrictEqual(
  clampNormalBounds({ x: 1900, y: 1000, width: 332, height: 600 }, display.workArea, 8),
  { x: 1580, y: 432, width: 332, height: 600 },
);

const mid = interpolateBounds(
  { x: 100, y: 0, width: 332, height: 400 },
  { x: 200, y: 100, width: 332, height: 400 },
  0.5,
);
assert.ok(mid.x > 150 && mid.x < 200, "animation should use smooth ease-out interpolation");
assert.ok(mid.y > 50 && mid.y < 100, "animation should use smooth ease-out interpolation");

const html = fs.readFileSync(path.join(__dirname, "..", "renderer", "index.html"), "utf8");
for (const side of EDGE_DOCK_SIDES) {
  assert.ok(html.includes(`name="edgeDockSide" value="${side}"`), `missing edge option: ${side}`);
}
assert.ok(html.includes('id="edgeDockEnabled"'));
assert.ok(html.includes('id="denseLayout"'));
assert.ok(html.includes('id="tokenAreaMaxHeight"'));
assert.ok(html.includes('토큰 영역 최대 높이'));
assert.ok(html.includes('edge-layout.css'));

const renderer = fs.readFileSync(path.join(__dirname, "..", "renderer", "app.js"), "utf8");
assert.ok(renderer.includes("viewport-constrained"));
assert.ok(renderer.includes("saveSettings({ denseLayout"));
assert.ok(renderer.includes("tokenAreaMaxHeight"));
assert.ok(renderer.includes("listEl.style.maxHeight"));
assert.ok(renderer.includes("edgeDockEnabled"));

const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
assert.ok(main.includes("screen.getCursorScreenPoint()"));
assert.ok(main.includes("EDGE_HIDE_DELAY_MS"));
assert.ok(main.includes("EDGE_SIDE_CHANGE_GRACE_MS"));
assert.ok(main.includes("edgeConfigRevision"));
assert.ok(main.includes("stableDockPositionHint"));
assert.ok(main.includes("sideChanged"));
assert.ok(main.includes("edgeGeometry.trigger"));
assert.ok(main.includes("requested > maxHeight"));

console.log("edge dock, max-height, and overflow tests passed");
