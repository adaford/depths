// Canvas setup + immediate-mode UI helpers.
// Logical resolution is 420x800 portrait, letterboxed to fit any screen.
// Buttons register tap regions each frame into `hits`; main.js routes pointerdown here.
export const W = 420, H = 800;
export let ctx = null;
let cnv = null, scale = 1, dpr = 1;

export function initCanvas(c) {
  cnv = c;
  ctx = c.getContext('2d');
  const fit = () => {
    dpr = window.devicePixelRatio || 1;
    scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    cnv.width = Math.round(W * scale * dpr);
    cnv.height = Math.round(H * scale * dpr);
    cnv.style.width = W * scale + 'px';
    cnv.style.height = H * scale + 'px';
    cnv.style.left = (window.innerWidth - W * scale) / 2 + 'px';
    cnv.style.top = (window.innerHeight - H * scale) / 2 + 'px';
  };
  fit();
  window.addEventListener('resize', fit);
}

export function frameStart() {
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  hits.length = 0;
  drags.length = 0;
  ctx.fillStyle = '#0b0b12';
  ctx.fillRect(0, 0, W, H);
}

export const hits = [];
export function hit(x, y, w, h, fn) { hits.push({ x, y, w, h, fn }); }

// drag zones (e.g. panning the combat camera); registered per-frame like hits.
// A zone may also take a pinch handler: pinch(factor, midX, midY) for two-finger
// zoom (and mouse wheel).
export const drags = [];
export function dragZone(x, y, w, h, fn, pinch) { drags.push({ x, y, w, h, fn, pinch }); }

export function toXY(e) {
  const r = cnv.getBoundingClientRect();
  return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
}

export function tap(pt) {
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if (pt.x >= h.x && pt.x <= h.x + h.w && pt.y >= h.y && pt.y <= h.y + h.h) { h.fn(pt); return; }
  }
}

// A press only counts as a tap if the pointer never strays ≥10 units; otherwise
// it feeds move deltas to whichever drag zone the press started in. A second
// finger turns the gesture into a pinch for zones that registered a pinch handler.
const pointers = new Map();
let pStart = null, pLast = null, isDrag = false, pinch = null;

function zoneAt(x, y, needPinch) {
  for (let i = drags.length - 1; i >= 0; i--) {
    const d = drags[i];
    if (needPinch && !d.pinch) continue;
    if (x >= d.x && x <= d.x + d.w && y >= d.y && y <= d.y + d.h) return d;
  }
  return null;
}

export function pointerDown(e) {
  const pt = toXY(e);
  pointers.set(e.pointerId, pt);
  if (pointers.size === 1) {
    pStart = pLast = pt;
    isDrag = false;
    pinch = null;
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const z = zoneAt((a.x + b.x) / 2, (a.y + b.y) / 2, true);
    pinch = z ? { fn: z.pinch, lastD: Math.hypot(a.x - b.x, a.y - b.y) } : { fn: null, lastD: 0 };
    pStart = null; // two fingers never tap
    isDrag = false;
  }
}
export function pointerMove(e) {
  if (!pointers.has(e.pointerId)) return;
  const pt = toXY(e);
  pointers.set(e.pointerId, pt);
  if (pinch) {
    if (pointers.size < 2 || !pinch.fn) return;
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > 0 && pinch.lastD > 0) pinch.fn(d / pinch.lastD, (a.x + b.x) / 2, (a.y + b.y) / 2);
    pinch.lastD = d;
    return;
  }
  if (!pStart) return;
  if (!isDrag && Math.hypot(pt.x - pStart.x, pt.y - pStart.y) >= 10) isDrag = true;
  if (isDrag) {
    const z = zoneAt(pStart.x, pStart.y, false);
    if (z) z.fn(pt.x - pLast.x, pt.y - pLast.y);
  }
  pLast = pt;
}
export function pointerUp(e) {
  if (e && e.pointerId !== undefined) pointers.delete(e.pointerId);
  else pointers.clear();
  if (pinch) {
    if (pointers.size < 2) { pinch = null; pStart = pLast = null; isDrag = false; }
    return;
  }
  if (pStart && !isDrag) tap(pStart);
  pStart = pLast = null;
  isDrag = false;
}
export function pointerCancel() {
  pointers.clear();
  pStart = pLast = null;
  isDrag = false;
  pinch = null;
}
export function wheel(e) {
  const pt = toXY(e);
  const z = zoneAt(pt.x, pt.y, true);
  if (z) z.pinch(e.deltaY < 0 ? 1.12 : 0.89, pt.x, pt.y);
}

export function rr(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function panel(x, y, w, h, r, fill, stroke) {
  rr(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
}

export function txt(s, x, y, size = 16, color = '#e8e4da', align = 'center', bold = false) {
  ctx.fillStyle = color;
  ctx.font = `${bold ? '700 ' : ''}${size}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

export function bar(x, y, w, h, frac, fg, label) {
  panel(x, y, w, h, h / 2, '#262633');
  const f = Math.max(0, Math.min(1, frac));
  if (f > 0) panel(x, y, Math.max(h, w * f), h, h / 2, fg);
  if (label) txt(label, x + w / 2, y + h / 2 + 1, Math.max(12, Math.round(h * 0.62)), '#fff', 'center', true);
}

export function button(x, y, w, h, label, fn, o = {}) {
  const dis = !!o.disabled;
  if (dis) ctx.globalAlpha = 0.4;
  panel(x, y, w, h, 14, o.fill || '#232338', o.stroke || '#3f3f5c');
  txt(label, x + w / 2, y + h / 2 - (o.sub ? 11 : 0), o.size || 20, o.color || '#e8e4da', 'center', true);
  if (o.sub) txt(o.sub, x + w / 2, y + h / 2 + 16, 14, '#aca9bc');
  if (dis) ctx.globalAlpha = 1;
  else hit(x, y, w, h, fn);
}

// floating combat numbers
export const floats = [];
export function addFloat(x, y, s, color) { floats.push({ x, y, s, color, t: 0 }); }
export function drawFloats(dt) {
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i];
    f.t += dt;
    f.y -= dt * 0.045;
    if (f.t >= 900) { floats.splice(i, 1); continue; }
    ctx.globalAlpha = Math.max(0, 1 - f.t / 900);
    txt(f.s, f.x, f.y, 24, f.color, 'center', true);
    ctx.globalAlpha = 1;
  }
}
