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

// drag zones (e.g. panning the combat camera); registered per-frame like hits
export const drags = [];
export function dragZone(x, y, w, h, fn) { drags.push({ x, y, w, h, fn }); }

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
// it feeds move deltas to whichever drag zone the press started in.
let pStart = null, pLast = null, isDrag = false;
export function pointerDown(e) { pStart = pLast = toXY(e); isDrag = false; }
export function pointerMove(e) {
  if (!pStart) return;
  const pt = toXY(e);
  if (!isDrag && Math.hypot(pt.x - pStart.x, pt.y - pStart.y) >= 10) isDrag = true;
  if (isDrag) {
    for (let i = drags.length - 1; i >= 0; i--) {
      const d = drags[i];
      if (pStart.x >= d.x && pStart.x <= d.x + d.w && pStart.y >= d.y && pStart.y <= d.y + d.h) {
        d.fn(pt.x - pLast.x, pt.y - pLast.y);
        break;
      }
    }
  }
  pLast = pt;
}
export function pointerUp() {
  if (pStart && !isDrag) tap(pStart);
  pStart = pLast = null;
  isDrag = false;
}
export function pointerCancel() { pStart = pLast = null; isDrag = false; }

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
  if (label) txt(label, x + w / 2, y + h / 2 + 1, Math.max(11, Math.round(h * 0.62)), '#fff', 'center', true);
}

export function button(x, y, w, h, label, fn, o = {}) {
  const dis = !!o.disabled;
  if (dis) ctx.globalAlpha = 0.4;
  panel(x, y, w, h, 14, o.fill || '#232338', o.stroke || '#3f3f5c');
  txt(label, x + w / 2, y + h / 2 - (o.sub ? 10 : 0), o.size || 20, o.color || '#e8e4da', 'center', true);
  if (o.sub) txt(o.sub, x + w / 2, y + h / 2 + 15, 12, '#8a8798');
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
