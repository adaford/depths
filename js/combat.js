// Tactical dungeon combat on a variable-size board (rooms + hallways, scrollable).
// Everything costs AP: moving (1/tile), attacking (weapon ap), skills (ap+mp+cooldown),
// potions (1), opening chests (1), defending (1, once per turn).
// Attacks reach diagonals (chebyshev range); stepping out of an enemy's reach
// provokes an opportunity attack — in both directions.
// Foes nap in their rooms until you come within AGRO range or hurt them, then act
// one micro-action per timed beat so their turn reads clearly.
// All combat state lives in G.combat (JSON-safe). FX is a render-side queue drained by screens.js.
import {
  G, save, goto, clearSave, afterCombatVictory, getPrimary, getSecondary, getArmor,
  addGearToBag, POT_MAX,
} from './game.js';
import { MONSTERS, SKILLS, POTIONS, WEAPONS, OFFHANDS, ARMOR, DROPS, getItem } from './data.js';
import { ri, pick, chance, rnd } from './rng.js';
import * as Gr from './grid.js';

export const FX = [];
export const AGRO = 6; // chebyshev distance at which a sleeping foe wakes
const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);
const C = () => G.combat;

function log(s) {
  const c = C();
  c.lines.push(s);
  if (c.lines.length > 2) c.lines.shift();
}

// ---------- encounter composition ----------
const POOLS = { easy: [], med: [], elite: [], minion: [], boss: [] };
for (const [id, m] of Object.entries(MONSTERS)) POOLS[m.pool].push(id);

function rollFoes(r, kind, row) {
  if (kind === 'boss') return ['m_dragon', 'm_whelp', 'm_whelp', 'm_whelp'];
  const ids = [];
  const easy = () => pick(r, POOLS.easy), med = () => pick(r, POOLS.med);
  if (row <= 1) ids.push(easy(), easy());
  else if (row <= 3) { ids.push(easy(), easy()); if (chance(r, 0.5)) ids.push(easy()); }
  else if (row <= 5) { ids.push(med(), chance(r, 0.5) ? med() : easy()); if (chance(r, 0.5)) ids.push(easy()); if (chance(r, 0.2)) ids.push(easy()); }
  else { ids.push(med(), med()); if (chance(r, 0.55)) ids.push(med()); if (chance(r, 0.3)) ids.push(easy()); if (chance(r, 0.35)) ids[0] = pick(r, POOLS.elite); }
  if (kind === 'ambush') ids.push(row <= 3 ? easy() : med());
  return ids.slice(0, 5);
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

// ---------- dungeon generation (rooms + hallways) ----------
function connectedFloors(w, h, blockedIdx) {
  const blocked = new Set(blockedIdx);
  let start = -1;
  for (let i = 0; i < w * h; i++) if (!blocked.has(i)) { start = i; break; }
  if (start < 0) return false;
  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const i = q.pop(), x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of Gr.DIRS) {
      const nx = x + dx, ny = y + dy, j = ny * w + nx;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h || blocked.has(j) || seen.has(j)) continue;
      seen.add(j);
      q.push(j);
    }
  }
  return seen.size === w * h - blocked.size;
}

function genDungeon(r, kind) {
  const w = kind === 'boss' ? 12 : ri(r, 9, 12);
  const h = kind === 'boss' ? 12 : ri(r, 10, 13);
  const carved = new Set();
  const rooms = [];
  const nRooms = kind === 'boss' ? 3 : ri(r, 3, 4);
  for (let n = 0; n < nRooms; n++) {
    for (let t = 0; t < 40; t++) {
      const rw = ri(r, 3, kind === 'boss' ? 6 : 5), rh = ri(r, 3, kind === 'boss' ? 6 : 5);
      const rx = ri(r, 0, w - rw), ry = ri(r, 0, h - rh);
      if (rooms.some(q => rx < q.x + q.w + 1 && q.x < rx + rw + 1 && ry < q.y + q.h + 1 && q.y < ry + rh + 1)) continue;
      rooms.push({ x: rx, y: ry, w: rw, h: rh });
      break;
    }
  }
  if (!rooms.length) rooms.push({ x: 2, y: 2, w: 5, h: 5 });
  for (const rm of rooms) {
    for (let y = rm.y; y < rm.y + rm.h; y++) for (let x = rm.x; x < rm.x + rm.w; x++) carved.add(y * w + x);
  }
  rooms.sort((a, b) => (b.y + b.h / 2) - (a.y + a.h / 2)); // bottom-most room first — player starts there
  const inRoom = (x, y) => rooms.some(rm => x >= rm.x && x < rm.x + rm.w && y >= rm.y && y < rm.y + rm.h);
  const cx = (rm) => Math.min(w - 1, rm.x + (rm.w >> 1)), cy = (rm) => Math.min(h - 1, rm.y + (rm.h >> 1));
  for (let i = 1; i < rooms.length; i++) {
    const x1 = cx(rooms[i - 1]), y1 = cy(rooms[i - 1]), x2 = cx(rooms[i]), y2 = cy(rooms[i]);
    if (chance(r, 0.5)) {
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) carved.add(y1 * w + x);
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) carved.add(y * w + x2);
    } else {
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) carved.add(y * w + x1);
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) carved.add(y2 * w + x);
    }
  }
  const walls = [];
  for (let i = 0; i < w * h; i++) if (!carved.has(i)) walls.push(i);
  return { w, h, walls, rooms, inRoom };
}

export function startCombat(kind, row) {
  const r = G.rng;
  const d = genDungeon(r, kind);
  const used = new Set(d.walls.map(i => Gr.k(i % d.w, (i / d.w) | 0)));
  const takeFrom = (cells) => {
    const free = cells.filter(([x, y]) => !used.has(Gr.k(x, y)));
    if (!free.length) return null;
    const [x, y] = pick(r, free);
    used.add(Gr.k(x, y));
    return { x, y };
  };
  const roomCells = (rm) => {
    const out = [];
    for (let y = rm.y; y < rm.y + rm.h; y++) for (let x = rm.x; x < rm.x + rm.w; x++) out.push([x, y]);
    return out;
  };
  const allFloor = [];
  for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) if (!d.walls.includes(y * d.w + x)) allFloor.push([x, y]);
  const hallCells = allFloor.filter(([x, y]) => !d.inRoom(x, y));

  const pxy = takeFrom(roomCells(d.rooms[0])) || takeFrom(allFloor);
  const farFrom = (cells, dist) => cells.filter(([x, y]) => Gr.cheb(x, y, pxy.x, pxy.y) >= dist);

  const foes = [];
  const foeRooms = d.rooms.slice(1);
  const anyRoomCells = foeRooms.length ? foeRooms.flatMap(roomCells) : roomCells(d.rooms[0]);
  rollFoes(r, kind, row).forEach((mid, i) => {
    const rm = foeRooms.length ? foeRooms[i % foeRooms.length] : d.rooms[0];
    const p = takeFrom(farFrom(roomCells(rm), 4)) || takeFrom(farFrom(anyRoomCells, 4))
      || takeFrom(farFrom(allFloor, 5)) || takeFrom(allFloor);
    if (!p) return;
    const m = MONSTERS[mid];
    foes.push({ mid, x: p.x, y: p.y, hp: m.hp, maxHp: m.hp, block: 0, buff: 0, stun: 0, psn: 0, psnT: 0, awake: false, dead: false });
  });

  const traps = [];
  const nt = kind === 'boss' ? ri(r, 3, 4) : ri(r, 2, 3);
  for (let i = 0; i < nt; i++) {
    const p = takeFrom(farFrom(hallCells, 3)) || takeFrom(farFrom(allFloor, 3));
    if (p) traps.push({ x: p.x, y: p.y, dmg: ri(r, 5, 7) + (row >= 6 ? 2 : 0), sprung: false });
  }
  const chests = [];
  const tryChest = () => {
    const p = takeFrom(farFrom(allFloor.filter(([x, y]) => d.inRoom(x, y)), 2));
    if (!p) return;
    const blocked = [...d.walls, ...chests.map(ch => ch.y * d.w + ch.x), p.y * d.w + p.x];
    if (connectedFloors(d.w, d.h, blocked)) chests.push({ x: p.x, y: p.y, opened: false });
  };
  if (chance(r, 0.6)) tryChest();
  if (chance(r, 0.3)) tryChest();
  const items = [];
  if (chance(r, 0.35)) {
    const p = takeFrom(farFrom(allFloor, 3));
    if (p) items.push({ x: p.x, y: p.y, t: 'gear', id: rollDropGear(r, row <= 3 ? 1 : row <= 6 ? 2 : 3), taken: false });
  }
  if (chance(r, 0.3)) { const p = takeFrom(farFrom(allFloor, 3)); if (p) items.push({ x: p.x, y: p.y, t: 'gold', v: ri(r, 6, 12), taken: false }); }

  G.player.mp = G.player.maxMp;
  G.combat = {
    kind, row, w: d.w, h: d.h, walls: d.walls, traps, chests, items, foes,
    px: pxy.x, py: pxy.y, ap: G.player.apMax, pBlock: 0, pPsn: 0, pPsnT: 0, defended: 0, acted: 0,
    cds: {}, mode: 'move', phase: 'player', turn: 1, info: -1, potIdx: -1, ei: 0, eap: -1,
    drops: { gold: 0, scrap: 0, gear: [] },
    lines: [kind === 'boss' ? 'The dragon’s lair. Tread softly.' : kind === 'ambush' ? 'Ambush! Foes close in.' : 'You enter the chamber…'],
    _due: 0,
  };
  goto('COMBAT');
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

function hitFoe(f, raw, pierce) {
  const m = MONSTERS[f.mid];
  f.awake = true;
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

function springTrap(tr, foe) {
  tr.sprung = true;
  if (foe) {
    foe.hp -= tr.dmg;
    foe.awake = true;
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

// Opportunity attacks: leaving a square adjacent (incl. diagonals) to an awake
// melee-capable enemy lets it strike once. Blink and forced movement don't provoke.
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
  for (const f of c.foes) {
    if (f.dead || !f.awake || f.stun > 0) continue;
    if (Gr.cheb(f.x, f.y, fromX, fromY) !== 1) continue;
    if (Gr.cheb(f.x, f.y, toX, toY) <= 1) continue;
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
  const d = Gr.reach(c, c.px, c.py, c.ap).get(Gr.k(x, y));
  if (!d) return;
  c.acted = 1;
  if (provokeFoes(c.px, c.py, x, y)) { die(); return; }
  c.ap -= d;
  c.px = x;
  c.py = y;
  pickupAt(x, y);
  const tr = Gr.trapAt(c, x, y);
  if (tr) {
    springTrap(tr, null);
    if (G.player.hp <= 0) { die(); return; }
  }
  save();
}

export function attackFoe(i) {
  const c = C();
  if (!c || c.phase !== 'player') return;
  const w = getPrimary();
  const f = c.foes[i];
  if (!f || f.dead || c.ap < w.ap || Gr.cheb(c.px, c.py, f.x, f.y) > w.rng) return;
  c.acted = 1;
  c.ap -= w.ap;
  hitFoe(f, Math.max(1, w.dmg + ri(G.rng, -1, 1)), false);
  if (!checkWin()) save();
}

export function defend() {
  const c = C();
  if (!c || c.phase !== 'player' || c.ap < 1 || c.defended) return;
  c.acted = 1;
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
  c.acted = 1;
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
  if (Gr.cheb(c.px, c.py, f.x, f.y) > p.rng) return;
  G.player.potions.splice(c.potIdx, 1);
  c.acted = 1;
  c.ap -= 1;
  c.mode = 'move';
  c.potIdx = -1;
  hitFoe(f, p.v, true);
  log('The bomb explodes!');
  if (!checkWin()) save();
}

export function openChestAt(x, y) {
  const c = C();
  if (!c || c.phase !== 'player' || c.ap < 1) return;
  const ch = c.chests.find(q => q.x === x && q.y === y && !q.opened);
  if (!ch || Gr.cheb(c.px, c.py, x, y) !== 1) return;
  c.acted = 1;
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
  if ((sk.tgt === 'foe' || sk.tgt === 'burst') &&
      !c.foes.some(f => !f.dead && Gr.cheb(c.px, c.py, f.x, f.y) <= sk.rng)) return 'No target';
  if (sk.fx === 'heal' && G.player.hp >= G.player.maxHp) return 'Full HP';
  return null;
}

// Valid targets for a targeted skill: foe indexes, or {x,y} tiles for blink.
export function skillTargets(slot) {
  const c = C();
  const sk = skillFor(slot);
  if (!c || !sk || skillIssue(slot)) return [];
  if (sk.tgt === 'foe') {
    return c.foes.map((f, i) => i).filter(i => {
      const f = c.foes[i];
      return !f.dead && Gr.cheb(c.px, c.py, f.x, f.y) <= sk.rng;
    });
  }
  if (sk.tgt === 'tile') {
    const out = [];
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
      if (Gr.open(c, x, y) && Gr.cheb(c.px, c.py, x, y) <= sk.rng) out.push({ x, y });
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
  if (sk.tgt === 'foe' && (!f || Gr.cheb(c.px, c.py, tx, ty) > sk.rng)) return;

  if (sk.fx === 'wx2') hitFoe(f, Math.max(1, w.dmg * 2 + ri(G.rng, -1, 1)), false);
  else if (sk.fx === 'dmg') hitFoe(f, sk.v, !!sk.pierce);
  else if (sk.fx === 'venom') {
    hitFoe(f, sk.v, false);
    if (!f.dead) { f.psn = 3; f.psnT = 3; FX.push({ tx: f.x, ty: f.y, v: '☠️', c: 'psn' }); }
  } else if (sk.fx === 'heal') {
    P.hp = Math.min(P.maxHp, P.hp + sk.v);
    FX.push({ tx: c.px, ty: c.py, v: `+${sk.v}❤️`, c: 'heal' });
  } else if (sk.fx === 'block') {
    c.pBlock += sk.v;
    FX.push({ tx: c.px, ty: c.py, v: `+${sk.v}🛡️`, c: 'blk' });
  } else if (sk.fx === 'blink') {
    if (!Gr.open(c, tx, ty) || Gr.cheb(c.px, c.py, tx, ty) > sk.rng) return;
    c.px = tx;
    c.py = ty;
    pickupAt(tx, ty);
  } else if (sk.fx === 'shove') {
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
    const hits = c.foes.filter(q => !q.dead && Gr.cheb(c.px, c.py, q.x, q.y) <= sk.rng);
    if (!hits.length) return;
    for (const q of hits) {
      hitFoe(q, sk.fx === 'whirl' ? Math.max(1, w.dmg + ri(G.rng, -1, 1)) : sk.v, false);
      if (sk.fx === 'nova' && !q.dead) { q.stun = 1; FX.push({ tx: q.x, ty: q.y, v: '🧊', c: 'blk' }); }
    }
  }

  c.acted = 1;
  c.ap -= sk.ap;
  P.mp -= sk.mp;
  if (sk.cd) c.cds[sk.id] = sk.cd;
  c.mode = 'move';
  log(`You cast ${sk.name}.`);
  // blink can land on a trap
  const tr = Gr.trapAt(c, c.px, c.py);
  if (sk.fx === 'blink' && tr) {
    springTrap(tr, null);
    if (G.player.hp <= 0) { die(); return; }
  }
  if (!checkWin()) save();
}

// ---------- board taps (immediate-mode UI routes here) ----------
export function tapBoard(x, y) {
  const c = C();
  if (!c || c.phase !== 'player') return;
  if (c.info >= 0) { c.info = -1; return; }
  const fi = foeIdxAt(c, x, y);
  if (c.mode === 'atk') {
    if (fi >= 0 && atkTargets().includes(fi)) { attackFoe(fi); return; }
  } else if (c.mode === 'sk0' || c.mode === 'sk1') {
    const slot = c.mode === 'sk1' ? 1 : 0;
    const sk = skillFor(slot);
    if (sk && sk.tgt === 'foe' && fi >= 0 && skillTargets(slot).includes(fi)) { castSkill(slot, x, y); return; }
    if (sk && sk.tgt === 'tile' && skillTargets(slot).some(t => t.x === x && t.y === y)) { castSkill(slot, x, y); return; }
  } else if (c.mode === 'bomb') {
    if (fi >= 0) { throwBomb(fi); return; }
  } else {
    if (fi >= 0) { c.info = fi; return; }
    const ch = Gr.chestAt(c, x, y);
    if (ch && !ch.opened && Gr.cheb(c.px, c.py, x, y) === 1) { openChestAt(x, y); return; }
    moveTo(x, y);
    return;
  }
  // invalid tap while targeting: inspect foes, otherwise cancel back to move
  if (fi >= 0) { c.info = fi; return; }
  c.mode = 'move';
  c.potIdx = -1;
}

// Foe indexes attackable with the current weapon right now.
export function atkTargets() {
  const c = C();
  const w = getPrimary();
  if (!c || c.phase !== 'player' || c.ap < w.ap) return [];
  return c.foes.map((f, i) => i).filter(i => {
    const f = c.foes[i];
    return !f.dead && Gr.cheb(c.px, c.py, f.x, f.y) <= w.rng;
  });
}

export function bombTargets() {
  const c = C();
  if (!c || c.mode !== 'bomb') return [];
  const id = G.player.potions[c.potIdx];
  if (!id) return [];
  return c.foes.map((f, i) => i).filter(i => {
    const f = c.foes[i];
    return !f.dead && Gr.cheb(c.px, c.py, f.x, f.y) <= POTIONS[id].rng;
  });
}

// ---------- enemy turn ----------
export function endTurn() {
  const c = C();
  if (!c || c.phase !== 'player') return;
  c.mode = 'move';
  c.info = -1;
  c.potIdx = -1;
  c.acted = 1;
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
    if (c2 && c2.phase === 'enemy') c2._due = t + 330;
  }
}

function foeAttack(c, f, m, mv) {
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
  for (;;) {
    while (c.ei < c.foes.length && c.foes[c.ei].dead) { c.ei++; c.eap = -1; }
    if (c.ei >= c.foes.length) { startPlayerTurn(); return; }
    const f = c.foes[c.ei], m = MONSTERS[f.mid];

    if (c.eap < 0) { // activation: wake check, block fades, poison ticks, stun checks
      if (!f.awake) {
        if (Gr.cheb(f.x, f.y, c.px, c.py) <= AGRO) {
          f.awake = true;
          FX.push({ tx: f.x, ty: f.y, v: '❗', c: 'buff' });
          log(`${m.name} notices you!`);
        } else {
          c.ei++; // still napping in its room — skip without a beat
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
      c.eap = m.ap;
      save();
      return; // activation beat
    }

    const dist = Gr.cheb(f.x, f.y, c.px, c.py);
    const rangedOnly = !m.moves.some(mv => mv.t === 'melee');
    const cheapShot = m.moves.filter(mv => mv.t === 'rng').reduce((a, b) => (a && a.ap <= b.ap ? a : b), null);

    // ranged-only foes stuck in your melee reach back off to shoot — eating your
    // opportunity attack on the way out
    if (rangedOnly && dist === 1 && cheapShot && c.eap >= 1 + cheapShot.ap) {
      const away = retreatStep(c, f);
      if (away) {
        c.eap -= 1;
        f.x = away.x;
        f.y = away.y;
        const w = getPrimary();
        hitFoe(f, Math.max(1, w.dmg + ri(G.rng, -1, 1)), false);
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
      mv.ap <= c.eap && ((mv.t === 'melee' && dist === 1) || (mv.t === 'rng' && dist <= mv.rng)));
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

// A 4-dir step that takes the foe out of the player's melee reach, avoiding traps.
function retreatStep(c, f) {
  let best = null, bd = 1;
  for (const [dx, dy] of Gr.DIRS) {
    const nx = f.x + dx, ny = f.y + dy;
    if (!Gr.open(c, nx, ny) || Gr.trapAt(c, nx, ny)) continue;
    const d = Gr.cheb(nx, ny, c.px, c.py);
    if (d > bd) { bd = d; best = { x: nx, y: ny }; }
  }
  return best;
}
