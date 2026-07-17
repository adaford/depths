// Spatial helpers for SQUARE tactical boards. Pure functions over a G.combat-shaped
// object — no game state of their own. Movement is 4-directional (1 AP per tile);
// attack ranges and adjacency use chebyshev distance (diagonals count).
// The map is solid rock with carved floors: `floors` (tile indexes, includes
// dug-out tiles), `dug` (rubble flavor), `wallDmg` {idx: hp} for chipped rock.
// Line of sight: a straight Bresenham line blocked by rock and by obstacles.
export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export const inB = (c, x, y) => x >= 0 && x < c.w && y >= 0 && y < c.h;
export const k = (x, y) => x + ',' + y;
export const idx = (c, x, y) => y * c.w + x;

export function neighbors(x, y) {
  return [[x + 1, y], [x - 1, y], [x, y - 1], [x, y + 1]];
}

export function dist(x1, y1, x2, y2) {
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
}

// center of tile (x,y) in board pixels (T = tile size)
export function toPixel(x, y, T) {
  return [x * T + T / 2, y * T + T / 2];
}
export function fromPixel(px, py, T) {
  return [Math.floor(px / T), Math.floor(py / T)];
}
export function boardPx(c, T) {
  return [c.w * T, c.h * T];
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

// Line of sight from (x1,y1) to (x2,y2): Bresenham, blocked by rock and obstacles
// on the tiles BETWEEN the endpoints. Pass shared sets when calling in a loop.
export function hasLoS(c, x1, y1, x2, y2, fs, obsSet) {
  fs = fs || floorSet(c);
  if (!obsSet) {
    obsSet = new Set();
    for (const o of c.obs) obsSet.add(idx(c, o.x, o.y));
  }
  let x = x1, y = y1;
  const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    if (x === x2 && y === y2) return true;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
    if (x === x2 && y === y2) return true;
    const i = y * c.w + x;
    if (!fs.has(i) || obsSet.has(i)) return false;
  }
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
