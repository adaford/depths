// Tactical dungeon combat on dense SQUARE maps (26-44 tiles a side) of tight rooms,
// chokepoint corridors, and caves — every map rolls a different generator style.
// Traps favor corridor mouths and chest sides; obstacles stand as cover in rooms.
// Fights open in a SCOUT phase: pan the map, inspect foes, swap your build, begin.
// While no enemy threatens you, EXPLORE freely (moves cost nothing, long strides);
// the moment someone engages, the AP economy kicks in: moving (1/tile, 4-way),
// attacking (weapon ap), skills (ap+mp+cooldown), potions (1), chests (1), defend
// (1, once per turn). Ranges are chebyshev — diagonals count; melee threatens all
// 8 surrounding tiles; stepping out of an enemy's reach provokes an opportunity
// attack — both ways. Ranged attacks (yours AND theirs) need LINE OF SIGHT: rock
// and obstacles block it, so cover is real.
// Every foe has a facing (the little wedge) — hit it from behind for CRIT damage
// (2x, daggers 3x). Every foe also has a sight range: get seen inside it (with
// LoS) and it wakes and comes for you; each also rolls a 0-4 turn sleep timer.
// Rock walls, obstacles, and traps have hp and can be smashed (dig shortcuts!);
// the map border is the only unbreakable thing.
// All combat state lives in G.combat (JSON-safe). FX is a render-side queue drained by screens.js.
import {
  G, save, goto, clearSave, afterCombatVictory, getPrimary, getSecondary, getArmor,
  addGearToBag, POT_MAX,
} from './game.js';
import { MONSTERS, SKILLS, POTIONS, WEAPONS, OFFHANDS, ARMOR, DROPS, getItem } from './data.js';
import { ri, pick, chance, rnd } from './rng.js';
import * as Gr from './grid.js';

export const FX = [];
export const EXPLORE_STEPS = 8;  // free-move stride per tap while nothing threatens
export const ENGAGE_R = 10;      // an awake foe this close pulls you into combat
export const CHASE_R = 20;       // once alarmed, pursuers this close keep you in it
export const FAR = 12;           // awake foes beyond this march silently (no beats)
export const WALL_HP = 12;
const OBS_TYPES = [['🪨', 10], ['🪵', 6], ['⚱️', 4]];
const FACES = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);
const C = () => G.combat;

function log(s) {
  const c = C();
  c.lines.push(s);
  if (c.lines.length > 2) c.lines.shift();
}

// Engaged while an awake foe is near. Alarm hysteresis: once a fight starts you
// stay in it while pursuers remain within CHASE_R — no free-move kiting.
export function isEngaged() {
  const c = C();
  if (!c) return false;
  let near = false, chase = false;
  for (const f of c.foes) {
    if (f.dead || !f.awake) continue;
    const d = Gr.dist(f.x, f.y, c.px, c.py);
    if (d <= ENGAGE_R) near = true;
    if (d <= CHASE_R) chase = true;
  }
  if (near) c.alarm = 1;
  else if (!chase) c.alarm = 0;
  return near || (!!c.alarm && chase);
}

export function nearestFoe() {
  const c = C();
  if (!c) return null;
  let best = null, bd = 1e9;
  for (const f of c.foes) {
    if (f.dead) continue;
    const d = Gr.dist(c.px, c.py, f.x, f.y);
    if (d < bd) { bd = d; best = f; }
  }
  return best ? { f: best, d: bd } : null;
}

// Attacker at (ax,ay) is behind the foe when it stands opposite the facing wedge.
export function isBehind(ax, ay, f) {
  return (ax - f.x) * f.face[0] + (ay - f.y) * f.face[1] < 0;
}

// ---------- encounter composition ----------
const POOLS = { easy: [], med: [], elite: [], minion: [], boss: [] };
for (const [id, m] of Object.entries(MONSTERS)) POOLS[m.pool].push(id);

// Wide variance on purpose: counts and mixes swing fight to fight.
function rollFoes(r, kind, row) {
  if (kind === 'boss') {
    const ids = ['m_dragon'];
    for (let i = 0, n = ri(r, 3, 5); i < n; i++) ids.push('m_whelp');
    return ids;
  }
  const ids = [];
  const easy = () => pick(r, POOLS.easy), med = () => pick(r, POOLS.med);
  if (row <= 1) { const n = ri(r, 3, 4); for (let i = 0; i < n; i++) ids.push(easy()); }
  else if (row <= 3) { const n = ri(r, 3, 5); for (let i = 0; i < n; i++) ids.push(chance(r, 0.85) ? easy() : med()); }
  else if (row <= 5) {
    const n = ri(r, 4, 6);
    ids.push(med());
    for (let i = 1; i < n; i++) ids.push(chance(r, 0.5) ? easy() : med());
  } else {
    const n = ri(r, 5, 8);
    ids.push(med(), med());
    for (let i = 2; i < n; i++) ids.push(chance(r, 0.55) ? med() : easy());
    if (chance(r, 0.4)) ids[0] = pick(r, POOLS.elite);
    if (chance(r, 0.18)) ids[1] = pick(r, POOLS.elite);
  }
  if (kind === 'ambush') ids.push(row <= 3 ? easy() : med());
  return ids.slice(0, 10);
}

function rollDropGear(r, tier) {
  const t = Math.min(5, tier + (chance(r, 0.2) ? 1 : 0));
  const x = rnd(r);
  const table = x < 0.4 ? WEAPONS : x < 0.65 ? OFFHANDS : ARMOR;
  let pool = Object.values(table).filter(g => g.tier === t);
  if (!pool.length) pool = Object.values(table).filter(g => g.tier <= t);
  if (!pool.length) pool = Object.values(table);
  return pick(r, pool).id;
}

// ---------- dungeon generation: dense square maps, three styles ----------
function genDungeon(r, kind) {
  const w = kind === 'boss' ? ri(r, 30, 42) : ri(r, 26, 44);
  const h = kind === 'boss' ? ri(r, 30, 42) : ri(r, 26, 44);
  const floors = new Set();
  const carve = (x, y) => { if (x >= 1 && x < w - 1 && y >= 1 && y < h - 1) floors.add(y * w + x); };
  const carveBlob = (cx, cy, rad) => {
    for (let y = cy - rad; y <= cy + rad; y++) {
      for (let x = cx - rad; x <= cx + rad; x++) {
        if (Gr.dist(x, y, cx, cy) <= rad) carve(x, y);
      }
    }
  };
  const rooms = [];
  const addRooms = (n) => {
    for (let i = 0; i < n; i++) {
      const rad = ri(r, 2, 4);
      const cx = ri(r, rad + 2, w - rad - 3), cy = ri(r, rad + 2, h - rad - 3);
      rooms.push({ x: cx, y: cy, rad });
      carveBlob(cx, cy, rad);
    }
  };
  // mostly 1-tile-wide, winding — corridors ARE the chokepoints
  const corridor = (x1, y1, x2, y2) => {
    let x = x1, y = y1, guard = (w + h) * 4;
    const wide = chance(r, 0.15);
    while ((x !== x2 || y !== y2) && guard-- > 0) {
      carve(x, y);
      const ns = Gr.neighbors(x, y).filter(([nx, ny]) => nx >= 1 && nx < w - 1 && ny >= 1 && ny < h - 1);
      if (!ns.length) break;
      if (wide) { const [ax, ay] = pick(r, ns); carve(ax, ay); }
      let best = ns[0], bd = 1e9;
      for (const nb of ns) { const d = Math.abs(nb[0] - x2) + Math.abs(nb[1] - y2); if (d < bd) { bd = d; best = nb; } }
      const step = chance(r, 0.3) ? pick(r, ns) : best;
      x = step[0];
      y = step[1];
    }
    carve(x2, y2);
  };
  const style = rnd(r);
  if (style < 0.55) { // halls and winding corridors
    addRooms(ri(r, 5, 10));
    const order = rooms.map((q, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = ri(r, 0, i); [order[i], order[j]] = [order[j], order[i]]; }
    for (let i = 1; i < order.length; i++) {
      const a = rooms[order[i - 1]], b = rooms[order[i]];
      corridor(a.x, a.y, b.x, b.y);
    }
    for (let i = 0; i < rooms.length; i++) {
      if (!chance(r, 0.2)) continue;
      const j = ri(r, 0, rooms.length - 1);
      if (j !== i) corridor(rooms[i].x, rooms[i].y, rooms[j].x, rooms[j].y);
    }
  } else if (style < 0.8) { // organic caves (drunkard walk)
    let x = (w / 2) | 0, y = (h / 2) | 0;
    const target = Math.floor(w * h * 0.24);
    let guard = target * 16;
    while (floors.size < target && guard-- > 0) {
      carve(x, y);
      const [nx, ny] = pick(r, Gr.neighbors(x, y));
      if (nx < 1 || nx >= w - 1 || ny < 1 || ny >= h - 1) { x = (w / 2) | 0; y = (h / 2) | 0; continue; }
      x = nx;
      y = ny;
    }
    const fl = [...floors];
    for (let i = 0, n = ri(r, 5, 9); i < n; i++) {
      const f = pick(r, fl);
      rooms.push({ x: f % w, y: (f / w) | 0, rad: 2 });
    }
  } else { // hybrid: halls with cave pockets eaten into them
    addRooms(ri(r, 4, 8));
    for (let i = 1; i < rooms.length; i++) corridor(rooms[i - 1].x, rooms[i - 1].y, rooms[i].x, rooms[i].y);
    for (let n = 0; n < 2; n++) {
      let { x, y } = pick(r, rooms);
      let steps = ri(r, 60, 160);
      while (steps-- > 0) {
        carve(x, y);
        const [nx, ny] = pick(r, Gr.neighbors(x, y));
        if (nx < 1 || nx >= w - 1 || ny < 1 || ny >= h - 1) continue;
        x = nx;
        y = ny;
      }
    }
  }
  return { w, h, floors, rooms };
}

function flood(w, h, floors, blocked, startIdx) {
  const seen = new Set([startIdx]);
  const q = [startIdx];
  while (q.length) {
    const i = q.pop(), x = i % w, y = (i / w) | 0;
    for (const [nx, ny] of Gr.neighbors(x, y)) {
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const j = ny * w + nx;
      if (seen.has(j) || !floors.has(j) || (blocked && blocked.has(j))) continue;
      seen.add(j);
      q.push(j);
    }
  }
  return seen;
}

export function startCombat(kind, row) {
  const r = G.rng;
  const d = genDungeon(r, kind);

  // player starts near the center of the bottom-most room
  d.rooms.sort((a, b) => b.y - a.y);
  const floorList = () => [...d.floors].map(i => [i % d.w, (i / d.w) | 0]);
  let all = floorList();
  const nearRoom = (rm, cells) => cells.filter(([x, y]) => Gr.dist(x, y, rm.x, rm.y) <= rm.rad);
  let startCell = nearRoom(d.rooms[0], all)[0] || all[0];
  for (const [x, y] of nearRoom(d.rooms[0], all)) {
    if (Gr.dist(x, y, d.rooms[0].x, d.rooms[0].y) < Gr.dist(startCell[0], startCell[1], d.rooms[0].x, d.rooms[0].y)) startCell = [x, y];
  }
  // prune anything the player can't walk to, and rooms whose centers got cut off
  d.floors = flood(d.w, d.h, d.floors, null, startCell[1] * d.w + startCell[0]);
  d.rooms = d.rooms.filter(rm => d.floors.has(rm.y * d.w + rm.x));
  all = floorList();

  const used = new Set([Gr.k(startCell[0], startCell[1])]);
  const takeFrom = (cells) => {
    const free = cells.filter(([x, y]) => !used.has(Gr.k(x, y)));
    if (!free.length) return null;
    const [x, y] = pick(r, free);
    used.add(Gr.k(x, y));
    return { x, y };
  };
  const pxy = { x: startCell[0], y: startCell[1] };
  const farFrom = (cells, dd) => cells.filter(([x, y]) => Gr.dist(x, y, pxy.x, pxy.y) >= dd);

  // foes arrive in clusters of 1-3, one room per cluster, far rooms first for the boss
  const foes = [];
  let candRooms = d.rooms.slice(1).filter(rm => Gr.dist(rm.x, rm.y, pxy.x, pxy.y) >= 12);
  if (!candRooms.length) candRooms = d.rooms.slice(1);
  if (!candRooms.length) candRooms = d.rooms;
  candRooms.sort((a, b) => Gr.dist(b.x, b.y, pxy.x, pxy.y) - Gr.dist(a.x, a.y, pxy.x, pxy.y));
  const ids = rollFoes(r, kind, row);
  let clusterRoom = 0;
  for (let i = 0; i < ids.length;) {
    const take = kind === 'boss' && i === 0 ? 1 + ri(r, 1, 2) : ri(r, 1, 3);
    const rm = candRooms[clusterRoom % candRooms.length];
    clusterRoom += kind === 'boss' ? ri(r, 1, 2) : 1;
    for (let n = 0; n < take && i < ids.length; n++, i++) {
      const p = takeFrom(farFrom(nearRoom(rm, all), 8)) || takeFrom(farFrom(all, 10)) || takeFrom(farFrom(all, 4)) || takeFrom(all);
      if (!p) break;
      const m = MONSTERS[ids[i]];
      const napT = ri(r, 0, 4); // every foe dozes 0-4 turns (0 = alert from the start)
      foes.push({
        mid: ids[i], x: p.x, y: p.y, hp: m.hp, maxHp: m.hp, block: 0, buff: 0, stun: 0, psn: 0, psnT: 0,
        napT, awake: napT === 0, face: pick(r, FACES).slice(), dead: false,
      });
    }
  }

  // clutter: dense on purpose — cover inside rooms, traps at chokepoints and loot
  const area = d.floors.size;
  const inAnyRoom = (x, y) => d.rooms.some(rm => Gr.dist(x, y, rm.x, rm.y) <= rm.rad);
  const roomFloor = all.filter(([x, y]) => inAnyRoom(x, y));
  const hallCells = all.filter(([x, y]) => !inAnyRoom(x, y));
  // corridor mouths: hall tiles touching a room — natural ambush/chokepoint spots
  const entranceCells = hallCells.filter(([x, y]) =>
    Gr.neighbors(x, y).some(([nx, ny]) => d.floors.has(ny * d.w + nx) && inAnyRoom(nx, ny)));
  const obs = [];
  const chests = [];
  const staticBlocked = () => new Set([...obs, ...chests].map(o => o.y * d.w + o.x));
  const keepsConnected = (x, y) => {
    const blocked = staticBlocked();
    blocked.add(y * d.w + x);
    const startI = pxy.y * d.w + pxy.x;
    if (blocked.has(startI)) return false;
    return flood(d.w, d.h, d.floors, blocked, startI).size === d.floors.size - blocked.size;
  };
  // obstacles mostly stand inside rooms: cover that blocks sight and shots
  const nObs = chance(r, 0.12) ? 0 : ri(r, 4, Math.min(20, 5 + Math.floor(area / 35)));
  for (let i = 0; i < nObs; i++) {
    const p = (chance(r, 0.7) ? takeFrom(farFrom(roomFloor, 2)) : null) || takeFrom(farFrom(all, 2));
    if (!p) break;
    if (!keepsConnected(p.x, p.y)) continue;
    const [e, hp] = pick(r, OBS_TYPES);
    obs.push({ x: p.x, y: p.y, hp, mhp: hp, e });
  }
  const traps = [];
  const addTrap = (p) => {
    if (p) traps.push({ x: p.x, y: p.y, dmg: ri(r, 5, 7) + (row >= 6 ? 2 : 0), hp: 5, mhp: 5, sprung: false });
  };
  const nt = chance(r, 0.12) ? ri(r, 1, 2) : ri(r, 3, Math.min(14, 4 + Math.floor(area / 60)));
  for (let i = 0; i < nt; i++) {
    addTrap((chance(r, 0.6) ? takeFrom(farFrom(entranceCells, 4)) : null)
      || takeFrom(farFrom(hallCells, 4)) || takeFrom(farFrom(all, 4)));
  }
  const nChests = chance(r, 0.25) ? 0 : ri(r, 1, 4);
  for (let i = 0; i < nChests; i++) {
    const p = takeFrom(farFrom(all, 4));
    if (!p) break;
    if (!keepsConnected(p.x, p.y)) continue;
    chests.push({ x: p.x, y: p.y, opened: false });
    if (chance(r, 0.5)) { // guarded loot: spikes beside the chest
      const spots = Gr.neighbors(p.x, p.y).filter(([nx, ny]) => d.floors.has(ny * d.w + nx));
      if (spots.length) addTrap(takeFrom(spots));
    }
  }
  const items = [];
  for (let i = 0, n = ri(r, 1, 5); i < n; i++) {
    const p = takeFrom(farFrom(all, 5));
    if (!p) break;
    if (chance(r, 0.5)) items.push({ x: p.x, y: p.y, t: 'gear', id: rollDropGear(r, row <= 3 ? 1 : row <= 6 ? 2 : 3), taken: false });
    else items.push({ x: p.x, y: p.y, t: 'gold', v: ri(r, 6, 12), taken: false });
  }

  G.player.mp = G.player.maxMp;
  G.combat = {
    kind, row, w: d.w, h: d.h,
    floors: [...d.floors], dug: [], wallDmg: {},
    obs, traps, chests, items, foes,
    px: pxy.x, py: pxy.y, ap: G.player.apMax, pBlock: 0, pPsn: 0, pPsnT: 0, pInvis: 0, defended: 0, alarm: 0,
    cds: {}, mode: 'move', phase: 'prep', turn: 1, info: -1, sel: -1, potIdx: -1, ei: 0, eap: -1,
    drops: { gold: 0, scrap: 0, gear: [] },
    lines: ['Scout the halls, set your build, then begin.'],
    _due: 0,
  };
  goto('COMBAT');
}

export function beginBattle() {
  const c = C();
  if (!c || c.phase !== 'prep') return;
  c.phase = 'player';
  c.sel = -1;
  wakeScan();
  log(isEngaged() ? 'Battle begins!' : 'All quiet… explore freely.');
  save();
}

// ---------- shared resolution ----------
function foeIdxAt(c, x, y) { return c.foes.findIndex(f => !f.dead && f.x === x && f.y === y); }

function die() {
  G.player.hp = 0;
  G.dead = true;
  G.combat = null;
  clearSave();
  G.screen = 'GAMEOVER';
}

function killFoe(f) {
  const c = C(), m = MONSTERS[f.mid];
  f.dead = true;
  G.stats.kills++;
  const dr = DROPS[m.pool];
  c.drops.gold += ri(G.rng, dr.gold[0], dr.gold[1]);
  c.drops.scrap += ri(G.rng, dr.scrap[0], dr.scrap[1]);
  if (dr.tier) c.drops.gear.push(rollDropGear(G.rng, dr.tier));
  log(`${m.name} is slain!`);
}

function checkWin() {
  const c = C();
  if (!c || c.foes.some(f => !f.dead)) return false;
  c.phase = 'over';
  if (c.kind === 'boss') {
    G.won = true;
    G.combat = null;
    clearSave();
    G.screen = 'VICTORY';
    return true;
  }
  afterCombatVictory(c);
  return true;
}

// attacking while hidden gives you away
function reveal() {
  const c = C();
  if (c.pInvis > 0) {
    c.pInvis = 0;
    log('You are revealed!');
  }
}

function hitFoe(f, raw, pierce) {
  const m = MONSTERS[f.mid];
  f.awake = true;
  f.napT = 0;
  let dmg = raw;
  if (!pierce) {
    const b = Math.min(f.block, dmg);
    f.block -= b;
    dmg -= b;
  }
  if (dmg > 0) dmg = Math.max(1, dmg - m.def);
  f.hp -= dmg;
  FX.push({ tx: f.x, ty: f.y, v: dmg > 0 ? `-${dmg}` : '🛡️', c: 'dmg' });
  if (f.hp <= 0) killFoe(f);
}

// weapon-flavored hit that can backstab-crit; returns the multiplier used
function weaponHit(f, base, fromX, fromY) {
  const w = getPrimary();
  const behind = isBehind(fromX, fromY, f);
  const mult = behind ? (w.crit || 2) : 1;
  hitFoe(f, Math.max(1, base * mult), false);
  if (behind) {
    FX.push({ tx: f.x, ty: f.y, v: `💥×${mult}`, c: 'buff' });
    log(`Backstab! ×${mult} damage.`);
  }
  return mult;
}

function springTrap(tr, foe) {
  tr.sprung = true;
  if (foe) {
    foe.hp -= tr.dmg;
    foe.awake = true;
    foe.napT = 0;
    FX.push({ tx: tr.x, ty: tr.y, v: `-${tr.dmg}`, c: 'dmg' });
    log(`${MONSTERS[foe.mid].name} triggers a trap!`);
    if (foe.hp <= 0) killFoe(foe);
  } else {
    G.player.hp -= tr.dmg;
    FX.push({ tx: tr.x, ty: tr.y, v: `-${tr.dmg}`, c: 'hurt' });
    log(`Spike trap! You take ${tr.dmg}.`);
  }
}

function pickupAt(x, y) {
  const c = C();
  const it = c.items.find(i => !i.taken && i.x === x && i.y === y);
  if (!it) return;
  it.taken = true;
  if (it.t === 'gold') {
    G.player.gold += it.v;
    G.stats.goldEarned += it.v;
    FX.push({ tx: x, ty: y, v: `+${it.v}💰`, c: 'gold' });
    log(`You grab ${it.v} gold.`);
  } else if (it.t === 'gear') {
    const g = getItem(it.id);
    const where = addGearToBag(it.id);
    log(`Picked up ${g.emoji} ${g.name}${where === 'scrap' ? ' — bag full, scrapped' : ''}.`);
  }
}

// Sleeping foes that can SEE the player (within their sight range, line of sight
// clear) wake up. Invisibility beats sight.
function wakeScan() {
  const c = C();
  if (c.pInvis > 0) return 0;
  const wasEngaged = isEngaged();
  const fs = Gr.floorSet(c);
  const obsSet = new Set(c.obs.map(o => o.y * c.w + o.x));
  let woke = 0;
  for (const f of c.foes) {
    if (f.dead || f.awake) continue;
    const m = MONSTERS[f.mid];
    if (Gr.dist(f.x, f.y, c.px, c.py) > m.sight) continue;
    if (!Gr.hasLoS(c, f.x, f.y, c.px, c.py, fs, obsSet)) continue;
    f.awake = true;
    f.napT = 0;
    f.face = [Math.sign(c.px - f.x), Math.sign(c.py - f.y)];
    woke++;
    FX.push({ tx: f.x, ty: f.y, v: '❗', c: 'buff' });
    log(`${m.name} spots you!`);
  }
  if (woke && !wasEngaged) c.ap = G.player.apMax; // the fight starts fresh
  return woke;
}

// Opportunity attacks: leaving a tile adjacent to an awake melee-capable enemy
// lets it strike once. Blink, Leap, teleports, and forced movement don't provoke.
function bestMelee(m) {
  let best = null;
  for (const mv of m.moves) if (mv.t === 'melee' && (!best || mv.dmg > best.dmg)) best = mv;
  return best;
}

function foeOpportunity(f, mv) {
  const c = C(), m = MONSTERS[f.mid];
  const raw = Math.max(1, mv.dmg + f.buff + ri(G.rng, -1, 1));
  const b = Math.min(c.pBlock, raw);
  c.pBlock -= b;
  let dealt = raw - b;
  if (dealt > 0) dealt = Math.max(1, dealt - getArmor().def);
  G.player.hp -= dealt;
  FX.push({ tx: c.px, ty: c.py, v: dealt > 0 ? `-${dealt}⚔️` : '🛡️', c: 'hurt' });
  log(`${m.name} strikes as you flee! ${dealt > 0 ? `-${dealt} HP` : 'Blocked.'}`);
}

function provokeFoes(fromX, fromY, toX, toY) {
  const c = C();
  if (c.pInvis > 0) return false; // they can't see you slip away
  for (const f of c.foes) {
    if (f.dead || !f.awake || f.stun > 0) continue;
    if (Gr.dist(f.x, f.y, fromX, fromY) !== 1) continue;
    if (Gr.dist(f.x, f.y, toX, toY) <= 1) continue;
    const mv = bestMelee(MONSTERS[f.mid]);
    if (!mv) continue;
    foeOpportunity(f, mv);
    if (G.player.hp <= 0) return true; // dead
  }
  return false;
}

// ---------- player actions ----------
export function setMode(m) {
  const c = C();
  if (!c || c.phase !== 'player') return;
  c.mode = c.mode === m ? 'move' : m;
  if (c.mode !== 'bomb') c.potIdx = -1;
}

export function closeInfo() { const c = C(); if (c) c.info = -1; }

export function moveTo(x, y) {
  const c = C();
  if (!c || c.phase !== 'player') return;
  const engaged = isEngaged();
  const d = Gr.reach(c, c.px, c.py, engaged ? c.ap : EXPLORE_STEPS).get(Gr.k(x, y));
  if (!d) return;
  if (engaged) {
    if (provokeFoes(c.px, c.py, x, y)) { die(); return; }
    c.ap -= d;
  }
  c.px = x;
  c.py = y;
  pickupAt(x, y);
  const tr = Gr.trapAt(c, x, y);
  if (tr) {
    springTrap(tr, null);
    if (G.player.hp <= 0) { die(); return; }
  }
  wakeScan();
  save();
}

export function attackFoe(i) {
  const c = C();
  if (!c || c.phase !== 'player') return;
  const w = getPrimary();
  const f = c.foes[i];
  if (!f || f.dead || c.ap < w.ap || Gr.dist(c.px, c.py, f.x, f.y) > w.rng) return;
  if (w.rng > 1 && Gr.dist(c.px, c.py, f.x, f.y) > 1 && !Gr.hasLoS(c, c.px, c.py, f.x, f.y)) return;
  c.ap -= w.ap;
  reveal();
  weaponHit(f, w.dmg + ri(G.rng, -1, 1), c.px, c.py);
  if (!checkWin()) save();
}

// A destructible thing (rock wall / obstacle / armed trap) at a tile, if any.
// Rock is only attackable where it borders walked floor.
function wallEdgeAt(c, x, y) {
  if (!Gr.inB(c, x, y)) return false;
  const fs = Gr.floorSet(c);
  if (fs.has(Gr.idx(c, x, y))) return false;
  if (x === 0 || y === 0 || x === c.w - 1 || y === c.h - 1) return false; // border is unbreakable
  return Gr.neighbors(x, y).some(([nx, ny]) => Gr.inB(c, nx, ny) && fs.has(Gr.idx(c, nx, ny)));
}

export function structAt(x, y) {
  const c = C();
  const ob = Gr.obsAt(c, x, y);
  if (ob) return { t: 'obs', o: ob };
  const tr = Gr.trapAt(c, x, y);
  if (tr) return { t: 'trap', o: tr };
  if (wallEdgeAt(c, x, y)) return { t: 'wall', o: { x, y } };
  return null;
}

export function structTargets() {
  const c = C();
  const w = getPrimary();
  if (!c || c.phase !== 'player' || c.mode !== 'atk' || c.ap < w.ap) return [];
  const out = [];
  for (const o of c.obs) if (Gr.dist(c.px, c.py, o.x, o.y) <= w.rng) out.push({ t: 'obs', x: o.x, y: o.y });
  for (const o of c.traps) if (!o.sprung && Gr.dist(c.px, c.py, o.x, o.y) <= w.rng) out.push({ t: 'trap', x: o.x, y: o.y });
  for (let y = c.py - w.rng; y <= c.py + w.rng; y++) {
    for (let x = c.px - w.rng; x <= c.px + w.rng; x++) {
      if (Gr.dist(c.px, c.py, x, y) <= w.rng && wallEdgeAt(c, x, y)) out.push({ t: 'wall', x, y });
    }
  }
  return out;
}

export function attackStructAt(x, y) {
  const c = C();
  if (!c || c.phase !== 'player') return;
  const w = getPrimary();
  const s = structAt(x, y);
  if (!s || c.ap < w.ap || Gr.dist(c.px, c.py, x, y) > w.rng) return;
  c.ap -= w.ap;
  reveal();
  const dmg = Math.max(1, w.dmg + ri(G.rng, -1, 1));
  if (s.t === 'wall') {
    const i = Gr.idx(c, x, y);
    const hp = (c.wallDmg[i] !== undefined ? c.wallDmg[i] : WALL_HP) - dmg;
    FX.push({ tx: x, ty: y, v: `-${dmg}`, c: 'dmg' });
    if (hp <= 0) {
      delete c.wallDmg[i];
      c.floors.push(i);
      c.dug.push(i);
      FX.push({ tx: x, ty: y, v: '💥', c: 'buff' });
      log('You dig through the rock!');
    } else {
      c.wallDmg[i] = hp;
    }
    save();
    return;
  }
  s.o.hp -= dmg;
  FX.push({ tx: x, ty: y, v: `-${dmg}`, c: 'dmg' });
  if (s.o.hp > 0) { save(); return; }
  if (s.t === 'obs') {
    c.obs.splice(c.obs.indexOf(s.o), 1);
    FX.push({ tx: x, ty: y, v: '💥', c: 'buff' });
    log(`The ${s.o.e === '🪨' ? 'boulder' : s.o.e === '🪵' ? 'log pile' : 'urn'} breaks apart!`);
    if (s.o.e === '⚱️' && chance(G.rng, 0.5)) {
      const v = ri(G.rng, 3, 7);
      G.player.gold += v;
      G.stats.goldEarned += v;
      FX.push({ tx: x, ty: y, v: `+${v}💰`, c: 'gold' });
      log(`${v} gold spills out!`);
    }
    wakeScan(); // cover you were hiding behind is gone
  } else {
    c.traps.splice(c.traps.indexOf(s.o), 1);
    FX.push({ tx: x, ty: y, v: '🔧', c: 'blk' });
    log('You dismantle the trap.');
  }
  save();
}

export function defend() {
  const c = C();
  if (!c || c.phase !== 'player' || c.ap < 1 || c.defended) return;
  c.defended = 1; // once per turn — block would stack absurdly otherwise
  c.ap -= 1;
  const gain = 2 + (getSecondary().block || 0) + getArmor().def;
  c.pBlock += gain;
  FX.push({ tx: c.px, ty: c.py, v: `+${gain}🛡️`, c: 'blk' });
  log(`You raise your guard (+${gain} block).`);
  save();
}

export function usePotion(i) {
  const c = C();
  if (!c || c.phase !== 'player' || c.ap < 1) return;
  const id = G.player.potions[i];
  if (!id) return;
  const p = POTIONS[id];
  if (p.fx === 'bomb') { c.mode = 'bomb'; c.potIdx = i; save(); return; } // aim first, spend on throw
  G.player.potions.splice(i, 1);
  c.ap -= 1;
  const P = G.player;
  if (p.fx === 'heal') { P.hp = Math.min(P.maxHp, P.hp + p.v); FX.push({ tx: c.px, ty: c.py, v: `+${p.v}❤️`, c: 'heal' }); }
  else if (p.fx === 'mana') { P.mp = Math.min(P.maxMp, P.mp + p.v); FX.push({ tx: c.px, ty: c.py, v: `+${p.v}🔮`, c: 'mp' }); }
  else if (p.fx === 'block') { c.pBlock += p.v; FX.push({ tx: c.px, ty: c.py, v: `+${p.v}🛡️`, c: 'blk' }); }
  log(`You drink a ${p.name}.`);
  save();
}

export function throwBomb(i) {
  const c = C();
  if (!c || c.phase !== 'player' || c.ap < 1) return;
  const f = c.foes[i];
  const id = G.player.potions[c.potIdx];
  if (!f || f.dead || !id || POTIONS[id].fx !== 'bomb') { c.mode = 'move'; c.potIdx = -1; return; }
  const p = POTIONS[id];
  if (Gr.dist(c.px, c.py, f.x, f.y) > p.rng || !Gr.hasLoS(c, c.px, c.py, f.x, f.y)) return;
  G.player.potions.splice(c.potIdx, 1);
  c.ap -= 1;
  c.mode = 'move';
  c.potIdx = -1;
  reveal();
  hitFoe(f, p.v, true);
  log('The bomb explodes!');
  if (!checkWin()) save();
}

export function openChestAt(x, y) {
  const c = C();
  if (!c || c.phase !== 'player' || c.ap < 1) return;
  const ch = c.chests.find(q => q.x === x && q.y === y && !q.opened);
  if (!ch || Gr.dist(c.px, c.py, x, y) !== 1) return;
  c.ap -= 1;
  ch.opened = true;
  const r = G.rng, x2 = rnd(r);
  if (x2 < 0.35) {
    const v = ri(r, 8, 16);
    G.player.gold += v;
    G.stats.goldEarned += v;
    FX.push({ tx: x, ty: y, v: `+${v}💰`, c: 'gold' });
    log(`Chest: ${v} gold!`);
  } else if (x2 < 0.6) {
    const v = ri(r, 2, 5);
    G.player.scrap += v;
    FX.push({ tx: x, ty: y, v: `+${v}🔩`, c: 'gold' });
    log(`Chest: ${v} scrap!`);
  } else if (x2 < 0.85) {
    if (G.player.potions.length < POT_MAX) {
      const p = POTIONS[pick(r, Object.keys(POTIONS))];
      G.player.potions.push(p.id);
      log(`Chest: a ${p.name}!`);
    } else {
      G.player.gold += 8;
      G.stats.goldEarned += 8;
      log('Chest: 8 gold (belt full).');
    }
  } else {
    const id = rollDropGear(r, c.row <= 3 ? 1 : 2);
    const g = getItem(id);
    const where = addGearToBag(id);
    log(`Chest: ${g.emoji} ${g.name}${where === 'scrap' ? ' — bag full, scrapped' : ''}!`);
  }
  save();
}

// ---------- skills ----------
export function skillFor(slot) { return SKILLS[G.player.eq[slot]] || null; }

// Reason the skill button is unusable right now, or null if castable.
export function skillIssue(slot) {
  const c = C();
  const sk = skillFor(slot);
  if (!sk) return 'Empty';
  if (!c || c.phase !== 'player') return 'Wait';
  if ((c.cds[sk.id] || 0) > 0) return `CD ${c.cds[sk.id]}`;
  if (c.ap < sk.ap) return 'Need AP';
  if (G.player.mp < sk.mp) return 'Need MP';
  if ((sk.tgt === 'foe' || sk.tgt === 'burst') && !skillTargetsRaw(sk).length) return 'No target';
  if (sk.fx === 'heal' && G.player.hp >= G.player.maxHp) return 'Full HP';
  if (sk.fx === 'vanish' && c.pInvis > 0) return 'Hidden';
  return null;
}

function skillTargetsRaw(sk) {
  const c = C();
  const out = [];
  const fs = Gr.floorSet(c);
  const obsSet = new Set(c.obs.map(o => o.y * c.w + o.x));
  for (let i = 0; i < c.foes.length; i++) {
    const f = c.foes[i];
    if (f.dead || Gr.dist(c.px, c.py, f.x, f.y) > sk.rng) continue;
    if (!sk.noLos && sk.rng > 1 && Gr.dist(c.px, c.py, f.x, f.y) > 1 &&
        !Gr.hasLoS(c, c.px, c.py, f.x, f.y, fs, obsSet)) continue;
    out.push(i);
  }
  return out;
}

// Valid targets for a targeted skill: foe indexes, or {x,y} tiles for blink/leap.
export function skillTargets(slot) {
  const c = C();
  const sk = skillFor(slot);
  if (!c || !sk || skillIssue(slot)) return [];
  if (sk.tgt === 'foe' || sk.tgt === 'burst') return skillTargetsRaw(sk);
  if (sk.tgt === 'tile') {
    const out = [];
    for (let y = c.py - sk.rng; y <= c.py + sk.rng; y++) {
      for (let x = c.px - sk.rng; x <= c.px + sk.rng; x++) {
        if (Gr.dist(c.px, c.py, x, y) <= sk.rng && Gr.open(c, x, y)) out.push({ x, y });
      }
    }
    return out;
  }
  return [];
}

export function castSkill(slot, tx, ty) {
  const c = C();
  if (!c || c.phase !== 'player') return;
  const sk = skillFor(slot);
  if (!sk || c.ap < sk.ap || G.player.mp < sk.mp || (c.cds[sk.id] || 0) > 0) return;
  const P = G.player, w = getPrimary();
  const fi = tx === undefined ? -1 : foeIdxAt(c, tx, ty);
  const f = fi >= 0 ? c.foes[fi] : null;
  if (sk.tgt === 'foe' && (!f || !skillTargetsRaw(sk).includes(fi))) return;

  if (sk.fx === 'wx2') { reveal(); weaponHit(f, w.dmg * 2 + ri(G.rng, -1, 1), c.px, c.py); }
  else if (sk.fx === 'dmg') { reveal(); hitFoe(f, sk.v, !!sk.pierce); }
  else if (sk.fx === 'venom') {
    reveal();
    hitFoe(f, sk.v, false);
    if (!f.dead) { f.psn = 3; f.psnT = 3; FX.push({ tx: f.x, ty: f.y, v: '☠️', c: 'psn' }); }
  } else if (sk.fx === 'heal') {
    P.hp = Math.min(P.maxHp, P.hp + sk.v);
    FX.push({ tx: c.px, ty: c.py, v: `+${sk.v}❤️`, c: 'heal' });
  } else if (sk.fx === 'block') {
    c.pBlock += sk.v;
    FX.push({ tx: c.px, ty: c.py, v: `+${sk.v}🛡️`, c: 'blk' });
  } else if (sk.fx === 'blink') {
    if (!Gr.open(c, tx, ty) || Gr.dist(c.px, c.py, tx, ty) > sk.rng) return;
    c.px = tx;
    c.py = ty;
    pickupAt(tx, ty);
    wakeScan();
  } else if (sk.fx === 'leap') {
    if (!Gr.open(c, tx, ty) || Gr.dist(c.px, c.py, tx, ty) > sk.rng) return;
    c.px = tx;
    c.py = ty;
    pickupAt(tx, ty);
    let hitAny = false;
    for (const q of c.foes) {
      if (q.dead || Gr.dist(c.px, c.py, q.x, q.y) !== 1) continue;
      weaponHit(q, w.dmg + ri(G.rng, -1, 1), c.px, c.py);
      hitAny = true;
    }
    if (hitAny) reveal();
    FX.push({ tx: c.px, ty: c.py, v: '🦘', c: 'buff' });
    wakeScan();
  } else if (sk.fx === 'rtele') {
    const spots = [];
    for (const i of c.floors) {
      const x = i % c.w, y = (i / c.w) | 0;
      if (Gr.open(c, x, y)) spots.push([x, y]);
    }
    if (!spots.length) return;
    const [nx, ny] = pick(G.rng, spots);
    c.px = nx;
    c.py = ny;
    FX.push({ tx: nx, ty: ny, v: '🎲', c: 'buff' });
    log('Reality lurches sideways…');
    pickupAt(nx, ny);
    const tr2 = Gr.trapAt(c, nx, ny);
    if (tr2) {
      springTrap(tr2, null);
      if (G.player.hp <= 0) { die(); return; }
    }
    wakeScan();
  } else if (sk.fx === 'vanish') {
    c.pInvis = sk.v;
    FX.push({ tx: c.px, ty: c.py, v: '🫥', c: 'blk' });
    log('You fade from sight.');
  } else if (sk.fx === 'stalk') {
    const bx = f.x - f.face[0], by = f.y - f.face[1];
    let spot = Gr.open(c, bx, by) ? [bx, by] : null;
    if (!spot) {
      for (let yy = f.y - 1; yy <= f.y + 1 && !spot; yy++) {
        for (let xx = f.x - 1; xx <= f.x + 1; xx++) {
          if (Gr.dist(xx, yy, f.x, f.y) === 1 && isBehind(xx, yy, f) && Gr.open(c, xx, yy)) { spot = [xx, yy]; break; }
        }
      }
    }
    if (!spot) { log('No room behind it!'); return; }
    c.px = spot[0];
    c.py = spot[1];
    FX.push({ tx: c.px, ty: c.py, v: '🥷', c: 'buff' });
  } else if (sk.fx === 'shove') {
    reveal();
    const dx = Math.sign(f.x - c.px), dy = Math.sign(f.y - c.py);
    let bonk = false;
    for (let s = 0; s < 2; s++) {
      const nx = f.x + dx, ny = f.y + dy;
      if (!Gr.open(c, nx, ny)) { bonk = true; break; }
      f.x = nx;
      f.y = ny;
      if (Gr.trapAt(c, nx, ny)) break;
    }
    hitFoe(f, sk.v + (bonk ? 3 : 0), false);
    const tr = Gr.trapAt(c, f.x, f.y);
    if (tr && !f.dead) springTrap(tr, f);
  } else if (sk.fx === 'whirl' || sk.fx === 'nova') {
    const hits = skillTargetsRaw(sk).map(i2 => c.foes[i2]);
    if (!hits.length) return;
    reveal();
    for (const q of hits) {
      if (sk.fx === 'whirl') weaponHit(q, w.dmg + ri(G.rng, -1, 1), c.px, c.py);
      else {
        hitFoe(q, sk.v, false);
        if (!q.dead) { q.stun = 1; FX.push({ tx: q.x, ty: q.y, v: '🧊', c: 'blk' }); }
      }
    }
  }

  c.ap -= sk.ap;
  P.mp -= sk.mp;
  if (sk.cd) c.cds[sk.id] = sk.cd;
  c.mode = 'move';
  log(`You cast ${sk.name}.`);
  // blink/leap can land on a trap
  const tr = Gr.trapAt(c, c.px, c.py);
  if ((sk.fx === 'blink' || sk.fx === 'leap') && tr) {
    springTrap(tr, null);
    if (G.player.hp <= 0) { die(); return; }
  }
  if (!checkWin()) save();
}

// ---------- board taps (immediate-mode UI routes here) ----------
export function tapBoard(x, y) {
  const c = C();
  if (!c) return;
  if (c.info >= 0) { c.info = -1; return; }
  const fi = foeIdxAt(c, x, y);
  if (c.phase === 'prep') { // scouting: taps only select/inspect
    if (fi >= 0) {
      if (c.sel === fi) { c.info = fi; c.sel = -1; }
      else c.sel = fi;
    } else c.sel = -1;
    return;
  }
  if (c.phase !== 'player') return;
  if (c.mode === 'atk') {
    if (fi >= 0 && atkTargets().includes(fi)) { attackFoe(fi); return; }
    const s = structAt(x, y);
    if (s && Gr.dist(c.px, c.py, x, y) <= getPrimary().rng) { attackStructAt(x, y); return; }
  } else if (c.mode === 'sk0' || c.mode === 'sk1') {
    const slot = c.mode === 'sk1' ? 1 : 0;
    const sk = skillFor(slot);
    if (sk && (sk.tgt === 'foe') && fi >= 0 && skillTargets(slot).includes(fi)) { castSkill(slot, x, y); return; }
    if (sk && sk.tgt === 'tile' && skillTargets(slot).some(t => t.x === x && t.y === y)) { castSkill(slot, x, y); return; }
  } else if (c.mode === 'bomb') {
    if (fi >= 0) { throwBomb(fi); return; }
  } else {
    // move mode: tap a foe once to preview its range + sight, again for details
    if (fi >= 0) {
      if (c.sel === fi) { c.info = fi; c.sel = -1; }
      else c.sel = fi;
      return;
    }
    c.sel = -1;
    const ch = Gr.chestAt(c, x, y);
    if (ch && !ch.opened && Gr.dist(c.px, c.py, x, y) === 1) { openChestAt(x, y); return; }
    moveTo(x, y);
    return;
  }
  // invalid tap while targeting: inspect foes, otherwise cancel back to move
  if (fi >= 0) { c.sel = fi; c.mode = 'move'; return; }
  c.mode = 'move';
  c.potIdx = -1;
}

// Foe indexes attackable with the current weapon right now (ranged needs LoS).
export function atkTargets() {
  const c = C();
  const w = getPrimary();
  if (!c || c.phase !== 'player' || c.ap < w.ap) return [];
  const fs = Gr.floorSet(c);
  const obsSet = new Set(c.obs.map(o => o.y * c.w + o.x));
  return c.foes.map((f, i) => i).filter(i => {
    const f = c.foes[i];
    if (f.dead || Gr.dist(c.px, c.py, f.x, f.y) > w.rng) return false;
    if (w.rng > 1 && Gr.dist(c.px, c.py, f.x, f.y) > 1 &&
        !Gr.hasLoS(c, c.px, c.py, f.x, f.y, fs, obsSet)) return false;
    return true;
  });
}

export function bombTargets() {
  const c = C();
  if (!c || c.mode !== 'bomb') return [];
  const id = G.player.potions[c.potIdx];
  if (!id) return [];
  const fs = Gr.floorSet(c);
  const obsSet = new Set(c.obs.map(o => o.y * c.w + o.x));
  return c.foes.map((f, i) => i).filter(i => {
    const f = c.foes[i];
    return !f.dead && Gr.dist(c.px, c.py, f.x, f.y) <= POTIONS[id].rng &&
      Gr.hasLoS(c, c.px, c.py, f.x, f.y, fs, obsSet);
  });
}

// ---------- foe movement/threat/sight preview (for the UI) ----------
export function foeReach(i, budget) {
  const c = C();
  const f = c.foes[i];
  if (!f || f.dead) return new Map();
  return Gr.reach(c, f.x, f.y, budget);
}

// Every tile this foe can currently SEE (within sight range, LoS clear).
export function foeSightField(i) {
  const c = C();
  const f = c.foes[i];
  if (!f || f.dead) return new Set();
  const m = MONSTERS[f.mid];
  const fs = Gr.floorSet(c);
  const obsSet = new Set(c.obs.map(o => o.y * c.w + o.x));
  const out = new Set();
  for (let y = Math.max(0, f.y - m.sight); y <= Math.min(c.h - 1, f.y + m.sight); y++) {
    for (let x = Math.max(0, f.x - m.sight); x <= Math.min(c.w - 1, f.x + m.sight); x++) {
      if (!fs.has(y * c.w + x)) continue;
      if (Gr.dist(f.x, f.y, x, y) > m.sight) continue;
      if (Gr.hasLoS(c, f.x, f.y, x, y, fs, obsSet)) out.add(Gr.k(x, y));
    }
  }
  return out;
}

// Can this foe damage the player this turn, moving up to `budget` AP then attacking?
export function foeThreatens(i, budget, rmap) {
  const c = C();
  const f = c.foes[i];
  if (!f || f.dead || f.stun > 0 || c.pInvis > 0) return false;
  const m = MONSTERS[f.mid];
  const fs = Gr.floorSet(c);
  const obsSet = new Set(c.obs.map(o => o.y * c.w + o.x));
  const canHitFrom = (x, y, mv) => {
    const rng = mv.t === 'melee' ? 1 : mv.rng;
    if (Gr.dist(x, y, c.px, c.py) > rng) return false;
    if (mv.t === 'rng' && Gr.dist(x, y, c.px, c.py) > 1 && !Gr.hasLoS(c, x, y, c.px, c.py, fs, obsSet)) return false;
    return true;
  };
  for (const mv of m.moves) {
    if (mv.t !== 'melee' && mv.t !== 'rng') continue;
    if (mv.ap <= budget && canHitFrom(f.x, f.y, mv)) return true;
    for (const [kk, d] of rmap) {
      if (d + mv.ap > budget) continue;
      const [x, y] = kk.split(',').map(Number);
      if (canHitFrom(x, y, mv)) return true;
    }
  }
  return false;
}

// ---------- enemy turn ----------
export function endTurn() {
  const c = C();
  if (!c || c.phase !== 'player' || !isEngaged()) return; // exploring has no turns
  c.mode = 'move';
  c.info = -1;
  c.sel = -1;
  c.potIdx = -1;
  c.phase = 'enemy';
  c.ei = 0;
  c.eap = -1;
  c._due = now() + 420;
  save();
}

function startPlayerTurn() {
  const c = C();
  c.phase = 'player';
  c.turn++;
  c.ap = G.player.apMax;
  c.pBlock = 0;
  c.defended = 0;
  if (c.pInvis > 0) {
    c.pInvis--;
    if (c.pInvis === 0) { log('You shimmer back into view.'); wakeScan(); }
  }
  for (const id of Object.keys(c.cds)) if (c.cds[id] > 0) c.cds[id]--;
  G.player.mp = Math.min(G.player.maxMp, G.player.mp + 2);
  if (c.pPsnT > 0) {
    c.pPsnT--;
    G.player.hp -= c.pPsn;
    FX.push({ tx: c.px, ty: c.py, v: `-${c.pPsn}☠️`, c: 'psn' });
    log(`Poison burns for ${c.pPsn}.`);
    if (G.player.hp <= 0) { die(); return; }
  }
  save();
}

// Called every frame; advances the enemy turn one micro-action at a time.
export function tick(t) {
  const c = G.combat;
  if (!c || G.screen !== 'COMBAT' || c.phase !== 'enemy') return;
  if (!c._due || c._due > t + 3000) c._due = t + 400; // stale timestamp after reload
  if (t >= c._due) {
    enemyMicro();
    const c2 = G.combat;
    if (c2 && c2.phase === 'enemy') c2._due = t + 320;
  }
}

function foeAttack(c, f, m, mv) {
  f.face = [Math.sign(c.px - f.x), Math.sign(c.py - f.y)];
  const raw = Math.max(1, mv.dmg + f.buff + ri(G.rng, -1, 1));
  const b = Math.min(c.pBlock, raw);
  c.pBlock -= b;
  let dealt = raw - b;
  if (dealt > 0) dealt = Math.max(1, dealt - getArmor().def);
  G.player.hp -= dealt;
  FX.push({ tx: c.px, ty: c.py, v: dealt > 0 ? `-${dealt}` : '🛡️', c: 'hurt' });
  log(`${m.name}: ${mv.name}${dealt > 0 ? ` — ${dealt} dmg` : ' — blocked!'}`);
  if (dealt > 0 && mv.psn) {
    c.pPsn = mv.psn[0];
    c.pPsnT = Math.max(c.pPsnT, mv.psn[1]);
    log('You are poisoned!');
  }
  if (mv.t === 'melee' && (getSecondary().thorns || 0) > 0 && !f.dead) {
    const th = getSecondary().thorns;
    f.hp -= th;
    FX.push({ tx: f.x, ty: f.y, v: `-${th}🦔`, c: 'dmg' });
    if (f.hp <= 0) killFoe(f);
  }
  if (G.player.hp <= 0) die();
}

function enemyMicro() {
  const c = C();
  const fs = Gr.floorSet(c);
  const obsSet = new Set(c.obs.map(o => o.y * c.w + o.x));
  for (;;) {
    while (c.ei < c.foes.length && c.foes[c.ei].dead) { c.ei++; c.eap = -1; }
    if (c.ei >= c.foes.length) { startPlayerTurn(); return; }
    const f = c.foes[c.ei], m = MONSTERS[f.mid];

    if (c.eap < 0) { // activation: wake checks, block fades, poison ticks, stun checks
      if (!f.awake) {
        if (c.pInvis <= 0 && Gr.dist(f.x, f.y, c.px, c.py) <= m.sight &&
            Gr.hasLoS(c, f.x, f.y, c.px, c.py, fs, obsSet)) {
          f.awake = true;
          f.napT = 0;
          f.face = [Math.sign(c.px - f.x), Math.sign(c.py - f.y)];
          FX.push({ tx: f.x, ty: f.y, v: '❗', c: 'buff' });
          log(`${m.name} spots you!`);
          // falls through and acts this turn — you got seen
        } else if (--f.napT <= 0) {
          f.napT = 0;
          f.awake = true; // slept off its timer; joins in from next turn
          FX.push({ tx: f.x, ty: f.y, v: '❗', c: 'buff' });
          c.ei++;
          c.eap = -1;
          continue;
        } else {
          c.ei++; // still dozing — skip without a beat
          continue;
        }
      }
      f.block = 0;
      if (f.psnT > 0) {
        f.psnT--;
        f.hp -= f.psn;
        FX.push({ tx: f.x, ty: f.y, v: `-${f.psn}☠️`, c: 'psn' });
        if (f.hp <= 0) {
          killFoe(f);
          if (checkWin()) return;
          c.ei++;
          c.eap = -1;
          continue;
        }
      }
      if (f.stun > 0) {
        f.stun--;
        FX.push({ tx: f.x, ty: f.y, v: '🧊', c: 'blk' });
        log(`${m.name} is frozen solid!`);
        c.ei++;
        c.eap = -1;
        save();
        return; // frozen beat is worth showing
      }
      // hidden player: awake foes mill about instead of hunting
      if (c.pInvis > 0) {
        c.ei++;
        c.eap = -1;
        continue;
      }
      // far from the action: march the whole turn silently, no beats, no camera
      if (Gr.dist(f.x, f.y, c.px, c.py) > FAR) {
        for (let s = 0; s < m.ap; s++) {
          const step = Gr.stepToward(c, f, c.px, c.py);
          if (!step) break;
          f.face = [Math.sign(step.x - f.x), Math.sign(step.y - f.y)];
          f.x = step.x;
          f.y = step.y;
          const tr = Gr.trapAt(c, f.x, f.y);
          if (tr) {
            springTrap(tr, f);
            if (checkWin()) return;
            if (f.dead) break;
          }
          if (Gr.dist(f.x, f.y, c.px, c.py) <= FAR) break; // reached the fight — loud from next turn
        }
        c.ei++;
        c.eap = -1;
        continue;
      }
      c.eap = m.ap;
      save();
      return; // activation beat
    }

    const dist = Gr.dist(f.x, f.y, c.px, c.py);
    const losToPlayer = () => Gr.hasLoS(c, f.x, f.y, c.px, c.py, fs, obsSet);
    const rangedOnly = !m.moves.some(mv => mv.t === 'melee');
    const cheapShot = m.moves.filter(mv => mv.t === 'rng').reduce((a, b) => (a && a.ap <= b.ap ? a : b), null);

    // ranged-only foes stuck in your melee reach back off to shoot — eating your
    // opportunity attack on the way out
    if (rangedOnly && dist === 1 && cheapShot && c.eap >= 1 + cheapShot.ap) {
      const away = retreatStep(c, f);
      if (away) {
        c.eap -= 1;
        f.face = [Math.sign(c.px - away.x), Math.sign(c.py - away.y)];
        f.x = away.x;
        f.y = away.y;
        const w = getPrimary();
        weaponHit(f, w.dmg + ri(G.rng, -1, 1), c.px, c.py);
        FX.push({ tx: c.px, ty: c.py, v: '⚔️!', c: 'dmg' });
        log(`You strike the retreating ${m.name}!`);
        if (checkWin()) return;
        if (!f.dead) {
          const tr = Gr.trapAt(c, f.x, f.y);
          if (tr) {
            springTrap(tr, f);
            if (checkWin()) return;
          }
        }
        if (c.eap <= 0) { c.ei++; c.eap = -1; }
        save();
        return;
      }
    }

    const atks = m.moves.filter(mv =>
      mv.ap <= c.eap && ((mv.t === 'melee' && dist === 1) ||
        (mv.t === 'rng' && dist <= mv.rng && (dist <= 1 || losToPlayer()))));
    if (atks.length) {
      const mv = atks.reduce((a, b) => (b.dmg > a.dmg ? b : a));
      c.eap -= mv.ap;
      foeAttack(c, f, m, mv);
      if (!G.combat || G.dead) return;
      if (checkWin()) return; // thorns can end the fight mid-enemy-phase
    } else {
      const guard = m.moves.find(mv => mv.t === 'guard' && mv.ap <= c.eap);
      const rage = m.moves.find(mv => mv.t === 'rage' && mv.ap <= c.eap);
      if (rage && f.buff === 0 && chance(G.rng, 0.4)) {
        f.buff = rage.atk;
        c.eap -= rage.ap;
        FX.push({ tx: f.x, ty: f.y, v: `+${rage.atk}💢`, c: 'buff' });
        log(`${m.name} uses ${rage.name}!`);
      } else if (dist > 1) {
        const step = Gr.stepToward(c, f, c.px, c.py);
        if (step && c.eap >= 1) {
          c.eap -= 1;
          f.face = [Math.sign(step.x - f.x), Math.sign(step.y - f.y)];
          f.x = step.x;
          f.y = step.y;
          const tr = Gr.trapAt(c, f.x, f.y);
          if (tr) {
            springTrap(tr, f);
            if (checkWin()) return;
          }
        } else if (guard && f.block === 0) {
          f.block = guard.block;
          c.eap -= guard.ap;
          FX.push({ tx: f.x, ty: f.y, v: `+${guard.block}🛡️`, c: 'blk' });
          log(`${m.name} uses ${guard.name}.`);
        } else {
          c.eap = 0;
        }
      } else if (guard && f.block === 0) {
        f.block = guard.block;
        c.eap -= guard.ap;
        FX.push({ tx: f.x, ty: f.y, v: `+${guard.block}🛡️`, c: 'blk' });
        log(`${m.name} uses ${guard.name}.`);
      } else {
        c.eap = 0;
      }
    }
    if (c.eap <= 0) { c.ei++; c.eap = -1; }
    save();
    return; // acted — wait a beat before the next micro-action
  }
}

// A one-tile step that takes the foe out of the player's melee reach, avoiding traps.
function retreatStep(c, f) {
  let best = null, bd = 1;
  for (const [nx, ny] of Gr.neighbors(f.x, f.y)) {
    if (!Gr.open(c, nx, ny) || Gr.trapAt(c, nx, ny)) continue;
    const d = Gr.dist(nx, ny, c.px, c.py);
    if (d > bd) { bd = d; best = { x: nx, y: ny }; }
  }
  return best;
}
