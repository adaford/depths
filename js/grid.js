// Spatial helpers for HEX tactical boards. Pure functions over a G.combat-shaped
// object — no game state of their own. Tiles are pointy-top hexes stored in
// "odd-r" offset coordinates (x = column, y = row; odd rows shift right half a
// hex). Movement is 1 AP per hex across 6 neighbors; ranges use hex distance.
// The map is solid rock with carved floors: `floors` (tile indexes, includes
// dug-out tiles), `dug` (rubble flavor), `wallDmg` {idx: hp} for chipped rock.
export const SQ3 = Math.sqrt(3);

export const inB = (c, x, y) => x >= 0 && x < c.w && y >= 0 && y < c.h;
export const k = (x, y) => x + ',' + y;
export const idx = (c, x, y) => y * c.w + x;

// odd-r offset neighbor deltas, by row parity
const N_EVEN = [[1, 0], [-1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1]];
const N_ODD = [[1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 1]];
export function neighbors(x, y) {
  const d = (y & 1) ? N_ODD : N_EVEN;
  return d.map(([dx, dy]) => [x + dx, y + dy]);
}

// offset <-> axial <-> pixel
export const toAxial = (x, y) => [x - ((y - (y & 1)) / 2), y];
export const axialToOffset = (q, r) => [q + ((r - (r & 1)) / 2), r];
export function dist(x1, y1, x2, y2) {
  const [q1, r1] = toAxial(x1, y1), [q2, r2] = toAxial(x2, y2);
  const dq = q1 - q2, dr = r1 - r2;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
// center of hex (x,y) in board pixels (S = hex radius); margin S keeps row 0 on-canvas
export function toPixel(x, y, S) {
  return [SQ3 * S * (x + 0.5 * (y & 1)) + S, 1.5 * S * y + S];
}
export function fromPixel(px, py, S) {
  const lx = px - S, ly = py - S;
  const q = (SQ3 / 3 * lx - ly / 3) / S;
  const r = (2 / 3 * ly) / S;
  // cube round
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(-q - r);
  const dq = Math.abs(rq - q), dr2 = Math.abs(rr - r), ds = Math.abs(rs - (-q - r));
  if (dq > dr2 && dq > ds) rq = -rr - rs;
  else if (dr2 > ds) rr = -rq - rs;
  return [rq + ((rr - (rr & 1)) / 2), rr];
}
export function boardPx(c, S) {
  return [SQ3 * S * (c.w + 0.5) + S, 1.5 * S * (c.h - 1) + 2 * S + S];
}

export function floorSet(c) { return new Set(c.floors); }
export const isFloor = (c, x, y, fs) => inB(c, x, y) && (fs || floorSet(c)).has(idx(c, x, y));
export const isRock = (c, x, y) => inB(c, x, y) && !floorSet(c).has(idx(c, x, y));

export function obsAt(c, x, y) { return c.obs.find(o => o.x === x && o.y === y) || null; }
export function chestAt(c, x, y) { return c.chests.find(ch => ch.x === x && ch.y === y) || null; }
export function trapAt(c, x, y) { return c.traps.find(t => t.x === x && t.y === y && !t.sprung) || null; }
export function foeAt(c, x, y) { return c.foes.find(f => !f.dead && f.x === x && f.y === y) || null; }

// One-off walkability check (builds its own floor set; use BFS fns for bulk work).
export function open(c, x, y) {
  return isFloor(c, x, y) && !obsAt(c, x, y) && !chestAt(c, x, y) &&
    !foeAt(c, x, y) && !(c.px === x && c.py === y);
}

function occSet(c) {
  const s = new Set();
  for (const o of c.obs) s.add(idx(c, o.x, o.y));
  for (const ch of c.chests) s.add(idx(c, ch.x, ch.y));
  for (const f of c.foes) if (!f.dead) s.add(idx(c, f.x, f.y));
  s.add(idx(c, c.px, c.py));
  return s;
}
function trapSet(c) {
  const s = new Set();
  for (const t of c.traps) if (!t.sprung) s.add(idx(c, t.x, t.y));
  return s;
}

// BFS: tiles reachable within `ap` steps from (sx,sy). Traps can be entered
// deliberately but end the path there. Returns Map of "x,y" -> step cost.
export function reach(c, sx, sy, ap) {
  const fs = floorSet(c), occ = occSet(c), traps = trapSet(c);
  const out = new Map();
  const seen = new Set([idx(c, sx, sy)]);
  let frontier = [[sx, sy]];
  for (let d = 1; d <= ap && frontier.length; d++) {
    const next = [];
    for (const [x, y] of frontier) {
      for (const [nx, ny] of neighbors(x, y)) {
        if (!inB(c, nx, ny)) continue;
        const i = idx(c, nx, ny);
        if (seen.has(i) || !fs.has(i) || occ.has(i)) continue;
        seen.add(i);
        out.set(k(nx, ny), d);
        if (!traps.has(i)) next.push([nx, ny]);
      }
    }
    frontier = next;
  }
  return out;
}

// Full BFS path from `from` toward tile (tx,ty) — the goal tile counts even when
// occupied (it's usually a unit). Returns array of [x,y] steps (excluding start,
// excluding the goal tile itself), or null if unreachable. Prefers trap-free routes.
export function pathToward(c, from, tx, ty) {
  const fs = floorSet(c), occ = occSet(c), traps = trapSet(c);
  return bfsPath(c, from, tx, ty, fs, occ, traps) || bfsPath(c, from, tx, ty, fs, occ, null);
}
export function stepToward(c, from, tx, ty) {
  const p = pathToward(c, from, tx, ty);
  return p && p.length ? { x: p[0][0], y: p[0][1] } : null;
}

function bfsPath(c, from, tx, ty, fs, occ, avoidTraps) {
  const start = idx(c, from.x, from.y);
  const goal = idx(c, tx, ty);
  const prev = new Map([[start, -1]]);
  const q = [[from.x, from.y]];
  let found = false;
  while (q.length && !found) {
    const [x, y] = q.shift();
    const cur = idx(c, x, y);
    for (const [nx, ny] of neighbors(x, y)) {
      if (!inB(c, nx, ny)) continue;
      const i = idx(c, nx, ny);
      if (prev.has(i)) continue;
      if (i === goal) { prev.set(i, cur); found = true; break; }
      if (!fs.has(i) || occ.has(i)) continue;
      if (avoidTraps && avoidTraps.has(i)) continue;
      prev.set(i, cur);
      q.push([nx, ny]);
    }
  }
  if (!found) return null;
  const path = [];
  let cur = goal;
  while (cur !== start) {
    path.push([cur % c.w, (cur / c.w) | 0]);
    cur = prev.get(cur);
  }
  path.reverse();
  path.pop(); // drop the goal tile itself — callers stop next to it
  return path;
}
