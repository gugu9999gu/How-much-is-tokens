const EDGE_SIDES = ["top", "right", "bottom", "left"];

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizeSide(value) {
  return EDGE_SIDES.includes(value) ? value : "right";
}

function pointInRect(point, rect, padding = 0) {
  if (!point || !rect) return false;
  return (
    point.x >= rect.x - padding &&
    point.x < rect.x + rect.width + padding &&
    point.y >= rect.y - padding &&
    point.y < rect.y + rect.height + padding
  );
}

function expandRect(rect, amount = 0) {
  const pad = Math.max(0, Number(amount) || 0);
  return {
    x: rect.x - pad,
    y: rect.y - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
}

function maxWidgetHeight(workArea, margin = 10) {
  const safeMargin = Math.max(0, Number(margin) || 0);
  const available = Number(workArea && workArea.height) || 0;
  return Math.max(220, available - safeMargin * 2);
}

function clampNormalBounds(bounds, workArea, margin = 8) {
  const safeMargin = Math.max(0, Number(margin) || 0);
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  const left = workArea.x + safeMargin;
  const top = workArea.y + safeMargin;
  const right = workArea.x + workArea.width - width - safeMargin;
  const bottom = workArea.y + workArea.height - height - safeMargin;
  return {
    x: Math.round(clamp(bounds.x, left, right)),
    y: Math.round(clamp(bounds.y, top, bottom)),
    width,
    height,
  };
}

function getDockGeometry(display, size, sideValue, position = null, options = {}) {
  const side = normalizeSide(sideValue);
  const bounds = display.bounds;
  const work = display.workArea;
  const width = Math.max(1, Math.round(size.width));
  const height = Math.max(1, Math.round(size.height));
  const margin = Math.max(0, Number(options.margin ?? 6));
  const peek = Math.max(0, Number(options.peek ?? 3));
  const triggerThickness = Math.max(2, Number(options.triggerThickness ?? 10));
  const triggerPadding = Math.max(0, Number(options.triggerPadding ?? 8));

  const hintX = Number.isFinite(position && position.x)
    ? position.x
    : work.x + work.width - width - margin;
  const hintY = Number.isFinite(position && position.y)
    ? position.y
    : work.y + margin;

  let shown;
  if (side === "top" || side === "bottom") {
    const x = clamp(hintX, work.x + margin, work.x + work.width - width - margin);
    const y = side === "top"
      ? work.y + margin
      : work.y + work.height - height - margin;
    shown = { x: Math.round(x), y: Math.round(y), width, height };
  } else {
    const x = side === "left"
      ? work.x + margin
      : work.x + work.width - width - margin;
    const y = clamp(hintY, work.y + margin, work.y + work.height - height - margin);
    shown = { x: Math.round(x), y: Math.round(y), width, height };
  }

  let hidden;
  if (side === "top") {
    hidden = { ...shown, y: Math.round(bounds.y - height + peek) };
  } else if (side === "bottom") {
    hidden = { ...shown, y: Math.round(bounds.y + bounds.height - peek) };
  } else if (side === "left") {
    hidden = { ...shown, x: Math.round(bounds.x - width + peek) };
  } else {
    hidden = { ...shown, x: Math.round(bounds.x + bounds.width - peek) };
  }

  let trigger;
  if (side === "top" || side === "bottom") {
    const triggerX = clamp(
      shown.x - triggerPadding,
      bounds.x,
      bounds.x + bounds.width - (shown.width + triggerPadding * 2),
    );
    trigger = {
      x: Math.round(triggerX),
      y: side === "top"
        ? bounds.y
        : Math.round(bounds.y + bounds.height - triggerThickness),
      width: Math.min(bounds.width, shown.width + triggerPadding * 2),
      height: triggerThickness,
    };
  } else {
    const triggerY = clamp(
      shown.y - triggerPadding,
      bounds.y,
      bounds.y + bounds.height - (shown.height + triggerPadding * 2),
    );
    trigger = {
      x: side === "left"
        ? bounds.x
        : Math.round(bounds.x + bounds.width - triggerThickness),
      y: Math.round(triggerY),
      width: triggerThickness,
      height: Math.min(bounds.height, shown.height + triggerPadding * 2),
    };
  }

  return { side, shown, hidden, trigger };
}

function interpolateBounds(from, to, progress) {
  const p = clamp(Number(progress) || 0, 0, 1);
  const eased = 1 - Math.pow(1 - p, 3);
  return {
    x: Math.round(from.x + (to.x - from.x) * eased),
    y: Math.round(from.y + (to.y - from.y) * eased),
    width: Math.round(from.width + (to.width - from.width) * eased),
    height: Math.round(from.height + (to.height - from.height) * eased),
  };
}

module.exports = {
  EDGE_SIDES,
  normalizeSide,
  clamp,
  pointInRect,
  expandRect,
  maxWidgetHeight,
  clampNormalBounds,
  getDockGeometry,
  interpolateBounds,
};
