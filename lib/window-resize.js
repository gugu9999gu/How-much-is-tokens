const RESIZE_DIRECTIONS = new Set(["n", "ne", "e", "se", "s", "sw", "w", "nw"]);
const MIN_WIDTH = 280;
const MIN_HEIGHT = 180;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function validDirection(value) {
  const direction = String(value || "").toLowerCase();
  return RESIZE_DIRECTIONS.has(direction) ? direction : null;
}

function resizeLocks(direction) {
  const dir = validDirection(direction) || "";
  return {
    width: dir.includes("e") || dir.includes("w"),
    height: dir.includes("n") || dir.includes("s"),
  };
}

function normalizeRect(rect) {
  if (!rect || typeof rect !== "object") return null;
  const x = Number(rect.x);
  const y = Number(rect.y);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function computeResizeBounds(initialBounds, direction, deltaX, deltaY, workArea, options = {}) {
  const initial = normalizeRect(initialBounds);
  const work = normalizeRect(workArea);
  const dir = validDirection(direction);
  if (!initial || !work || !dir) return initial ? { ...initial } : null;

  const minWidth = Math.max(1, Number(options.minWidth) || MIN_WIDTH);
  const minHeight = Math.max(1, Number(options.minHeight) || MIN_HEIGHT);
  const dx = Number.isFinite(Number(deltaX)) ? Number(deltaX) : 0;
  const dy = Number.isFinite(Number(deltaY)) ? Number(deltaY) : 0;
  const workRight = work.x + work.width;
  const workBottom = work.y + work.height;

  let x = initial.x;
  let y = initial.y;
  let width = initial.width;
  let height = initial.height;

  if (dir.includes("e")) {
    const maxWidth = Math.max(minWidth, workRight - initial.x);
    width = clamp(initial.width + dx, minWidth, maxWidth);
  } else if (dir.includes("w")) {
    const right = initial.x + initial.width;
    const maxX = right - minWidth;
    x = clamp(initial.x + dx, work.x, maxX);
    width = right - x;
  }

  if (dir.includes("s")) {
    const maxHeight = Math.max(minHeight, workBottom - initial.y);
    height = clamp(initial.height + dy, minHeight, maxHeight);
  } else if (dir.includes("n")) {
    const bottom = initial.y + initial.height;
    const maxY = bottom - minHeight;
    y = clamp(initial.y + dy, work.y, maxY);
    height = bottom - y;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function normalizeManualWindowSize(value, options = {}) {
  if (!value || typeof value !== "object") return null;
  const minWidth = Math.max(1, Number(options.minWidth) || MIN_WIDTH);
  const minHeight = Math.max(1, Number(options.minHeight) || MIN_HEIGHT);
  const maxWidth = Math.max(minWidth, Number(options.maxWidth) || 10000);
  const maxHeight = Math.max(minHeight, Number(options.maxHeight) || 10000);
  const next = {};
  const width = Number(value.width);
  const height = Number(value.height);
  if (Number.isFinite(width) && width > 0) next.width = Math.round(clamp(width, minWidth, maxWidth));
  if (Number.isFinite(height) && height > 0) next.height = Math.round(clamp(height, minHeight, maxHeight));
  return Object.keys(next).length ? next : null;
}

module.exports = {
  RESIZE_DIRECTIONS,
  MIN_WIDTH,
  MIN_HEIGHT,
  validDirection,
  resizeLocks,
  computeResizeBounds,
  normalizeManualWindowSize,
};
