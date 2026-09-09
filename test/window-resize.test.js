const assert = require("assert");
const {
  MIN_WIDTH,
  MIN_HEIGHT,
  resizeLocks,
  computeResizeBounds,
  normalizeManualWindowSize,
} = require("../lib/window-resize");

const work = { x: 0, y: 0, width: 1000, height: 800 };
const initial = { x: 100, y: 100, width: 400, height: 300 };

assert.deepStrictEqual(computeResizeBounds(initial, "e", 120, 0, work), {
  x: 100, y: 100, width: 520, height: 300,
});
assert.deepStrictEqual(computeResizeBounds(initial, "w", 50, 0, work), {
  x: 150, y: 100, width: 350, height: 300,
});
assert.deepStrictEqual(computeResizeBounds(initial, "nw", -300, -300, work), {
  x: 0, y: 0, width: 500, height: 400,
});
assert.deepStrictEqual(computeResizeBounds(initial, "se", 900, 900, work), {
  x: 100, y: 100, width: 900, height: 700,
});
assert.deepStrictEqual(computeResizeBounds(initial, "w", 390, 0, work), {
  x: 220, y: 100, width: MIN_WIDTH, height: 300,
});
assert.deepStrictEqual(computeResizeBounds(initial, "n", 0, 290, work), {
  x: 100, y: 220, width: 400, height: MIN_HEIGHT,
});

assert.deepStrictEqual(resizeLocks("e"), { width: true, height: false });
assert.deepStrictEqual(resizeLocks("n"), { width: false, height: true });
assert.deepStrictEqual(resizeLocks("se"), { width: true, height: true });
assert.deepStrictEqual(normalizeManualWindowSize({ width: 555 }), { width: 555 });
assert.deepStrictEqual(normalizeManualWindowSize({ height: 444 }), { height: 444 });
assert.deepStrictEqual(normalizeManualWindowSize({ width: 10, height: 20 }), {
  width: MIN_WIDTH,
  height: MIN_HEIGHT,
});
assert.strictEqual(normalizeManualWindowSize({}), null);

console.log("manual widget resize geometry tests passed");
