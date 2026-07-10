// Spatial helpers for tactical boards. Pure functions over a G.combat-shaped
// object (w/h/walls/traps/chests/foes/px/py) — no game state of their own.
// Movement is 4-directional; attack ranges use chebyshev (diagonals count).
export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export const inB = (c, x, y) => x >= 0 && x < c.w && y >= 0 && y < c.h;
export const man = (x1, y1, x2, y2) => Math.abs(x1 - x2) + Math.abs(y1 - y2);
export const cheb = (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
export const k = (x, y) => x + ',' + y;

export function wallAt(c, x, y) { return c.walls.includes(y * c.w + x); }
export function chestAt(c, x, y) { return c.chests.find(ch => ch.x === x && ch.y === y) || null; }
export function trapAt(c, x, y) { return c.traps.find(t => t.x === x && t.y === y && !t.sprung) || null; }
export function foeAt(c, x, y) { return c.foes.find(f => !f.dead && f.x === x && f.y === y) || null; }

// Walkable for pathing purposes (traps ARE walkable — they're handled separately).
export function open(c, x, y) {
  return inB(c, x, y) && !wallAt(c, x, y) && !chestAt(c, x, y) && !foeAt(c, x, y) && !(c.px === x && c.py === y);
}

// BFS: tiles reachable within `ap` steps. Traps can be entered deliberately but end
// the path there (no walking through). Returns Map of "x,y" -> step cost.
export function reach(c, sx, sy, ap) {
  const out = new Map();
  const seen = new Set([k(sx, sy)]);
  let frontier = [[sx, sy]];
  for (let d = 1; d <= ap && frontier.length; d++) {
    const next = [];
    for (const [x, y] of frontier) {
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy, kk = k(nx, ny);
        if (seen.has(kk) || !open(c, nx, ny)) continue;
        seen.add(kk);
        out.set(kk, d);
        if (!trapAt(c, nx, ny)) next.push([nx, ny]);
      }
    }
    frontier = next;
  }
  return out;
}

// First step for a foe at f walking toward tile (tx,ty) (usually the player, whose
// tile counts as the goal even though it's occupied). Prefers trap-free routes.
export function stepToward(c, f, tx, ty) {
  return bfsStep(c, f, tx, ty, false) || bfsStep(c, f, tx, ty, true);
}

function bfsStep(c, f, tx, ty, allowTraps) {
  const start = k(f.x, f.y);
  const prev = new Map([[start, null]]);
  const q = [[f.x, f.y]];
  let goal = null;
  while (q.length && !goal) {
    const [x, y] = q.shift();
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy, kk = k(nx, ny);
      if (prev.has(kk)) continue;
      if (nx === tx && ny === ty) { prev.set(kk, k(x, y)); goal = kk; break; }
      if (!open(c, nx, ny)) continue;
      if (!allowTraps && trapAt(c, nx, ny)) continue;
      prev.set(kk, k(x, y));
      q.push([nx, ny]);
    }
  }
  if (!goal) return null;
  let cur = goal;
  while (prev.get(cur) !== start) cur = prev.get(cur);
  if (cur === goal) return null; // already adjacent to the goal — no step needed
  const [x, y] = cur.split(',').map(Number);
  return { x, y };
}
