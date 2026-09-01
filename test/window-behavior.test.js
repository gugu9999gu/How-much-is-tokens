const assert = require("assert");
const { applyAlwaysOnTop } = require("../lib/window-behavior");

function mockWindow(initial = false) {
  let state = initial;
  const calls = [];
  return {
    calls,
    isDestroyed: () => false,
    setAlwaysOnTop(flag, level) {
      calls.push(["setAlwaysOnTop", flag, level]);
      state = !!flag;
    },
    moveTop() {
      calls.push(["moveTop"]);
    },
    isAlwaysOnTop() {
      return state;
    },
  };
}

const enabled = mockWindow(false);
assert.strictEqual(applyAlwaysOnTop(enabled, true), true);
assert.deepStrictEqual(enabled.calls[0], ["setAlwaysOnTop", true, "screen-saver"]);
assert.deepStrictEqual(enabled.calls[1], ["moveTop"]);

const disabled = mockWindow(true);
assert.strictEqual(applyAlwaysOnTop(disabled, false), true);
assert.deepStrictEqual(disabled.calls, [["setAlwaysOnTop", false, undefined]]);

assert.strictEqual(applyAlwaysOnTop(null, false), false);

console.log("window always-on-top behavior tests passed");
