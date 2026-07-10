// Tactical grid combat on a 7x7 board. Everything costs AP: moving (1/tile),
// attacking (weapon ap), skills (ap+mp), potions (1), opening chests (1), defending (1).
// Foes act one micro-action at a time on a timer so their turn reads clearly.
// All combat state lives in G.combat (JSON-safe). FX is a render-side queue drained by screens.js.
import {
  G, save, goto, clearSave, afterCombatVictory, getPrimary, getSecondary, getArmor,
  addGearToBag, POT_MAX,
} from './game.js';
import { MONSTERS, SKILLS, POTIONS, WEAPONS, OFFHANDS, ARMOR, DROPS, getItem } from './data.js';
import { ri, pick, chance, rnd } from './rng.js';
import * as Gr from './grid.js';

export const FX = [];
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
  else if (row === 2) { ids.push(easy(), easy()); if (chance(r, 0.5)) ids.push(easy()); }
  else if (row === 3) { ids.push(med(), easy()); if (chance(r, 0.45)) ids.push(easy()); }
  else if (row === 4) { ids.push(med(), med()); if (chance(r, 0.4)) ids.push(easy()); if (chance(r, 0.3)) ids[0] = pick(r, POOLS.elite); }
  else { ids.push(med(), med()); if (chance(r, 0.5)) ids.push(med()); if (chance(r, 0.35)) ids[0] = pick(r, POOLS.elite); }
  if (kind === 'ambush') ids.push(row <= 2 ? easy() : med());
  return ids.slice(0, 4);
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

// ---------- room generation ----------
function connectedFloors(blockedIdx) {
  const blocked = new Set(blockedIdx);
  let start = -1;
  for (let i = 0; i < 49; i++) if (!blocked.has(i)) { start = i; break; }
  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const i = q.pop(), x = i % 7, y = (i / 7) | 0;
    for (const [dx, dy] of Gr.DIRS) {
      const nx = x + dx, ny = y + dy, j = ny * 7 + nx;
      if (!Gr.inB(nx, ny) || blocked.has(j) || seen.has(j)) continue;
      seen.add(j);
      q.push(j);
    }
  }
  return seen.size === 49 - blocked.size;
}

export function startCombat(kind, row) {
  const r = G.rng;
  let walls = [];
  for (let t = 0; t < 40; t++) {
    walls = [];
    const n = ri(r, 4, kind === 'boss' ? 6 : 8);
    while (walls.length < n) {
      const i = ri(r, 1, 5) * 7 + ri(r, 0, 6); // keep spawn rows (0 and 6) clear
      if (!walls.includes(i)) walls.push(i);
    }
    if (connectedFloors(walls)) break;
  }
  const used = new Set(walls.map(i => Gr.k(i % 7, (i / 7) | 0)));
  const take = (ys) => {
    const cells = [];
    for (const y of ys) for (let x = 0; x < 7; x++) if (!used.has(Gr.k(x, y))) cells.push([x, y]);
    if (!cells.length) return null;
    const [x, y] = pick(r, cells);
    used.add(Gr.k(x, y));
    return { x, y };
  };
  const pxy = take([6]);
  const foes = [];
  for (const mid of rollFoes(r, kind, row)) {
    const p = take([0, 1]) || take([2]);
    if (!p) break;
    const m = MONSTERS[mid];
    foes.push({ mid, x: p.x, y: p.y, hp: m.hp, maxHp: m.hp, block: 0, buff: 0, stun: 0, psn: 0, psnT: 0, dead: false });
  }
  const traps = [];
  const nt = kind === 'boss' ? ri(r, 2, 4) : ri(r, 1, 3);
  for (let i = 0; i < nt; i++) {
    const p = take([2, 3, 4]);
    if (p) traps.push({ x: p.x, y: p.y, dmg: ri(r, 5, 7) + (row >= 4 ? 2 : 0), sprung: false });
  }
  // chests block movement, so only place ones that keep the room fully connected
  const chests = [];
  const tryChest = () => {
    const p = take([1, 2, 3, 4, 5]);
    if (!p) return;
    const blocked = [...walls, ...chests.map(ch => ch.y * 7 + ch.x), p.y * 7 + p.x];
    if (connectedFloors(blocked)) chests.push({ x: p.x, y: p.y, opened: false });
  };
  if (chance(r, 0.55)) tryChest();
  if (chance(r, 0.22)) tryChest();
  const items = [];
  if (chance(r, 0.3)) {
    const p = take([2, 3, 4]);
    if (p) items.push({ x: p.x, y: p.y, t: 'gear', id: rollDropGear(r, row <= 2 ? 1 : row <= 4 ? 2 : 3), taken: false });
  }
  if (chance(r, 0.25)) { const p = take([2, 3, 4]); if (p) items.push({ x: p.x, y: p.y, t: 'gold', v: ri(r, 6, 12), taken: false }); }

  G.player.mp = G.player.maxMp;
  G.combat = {
    kind, row, walls, traps, chests, items, foes,
    px: pxy.x, py: pxy.y, ap: G.player.apMax, pBlock: 0, pPsn: 0, pPsnT: 0, defended: 0,
    mode: 'move', phase: 'player', turn: 1, info: -1, potIdx: -1, ei: 0, eap: -1,
    drops: { gold: 0, scrap: 0, gear: [] },
    lines: [kind === 'boss' ? 'The Ancient Dragon awakens!' : kind === 'ambush' ? 'Ambush! Foes close in.' : 'Foes block your path.'],
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
  if (!f || f.dead || c.ap < w.ap || Gr.man(c.px, c.py, f.x, f.y) > w.rng) return;
  c.ap -= w.ap;
  hitFoe(f, Math.max(1, w.dmg + ri(G.rng, -1, 1)), false);
  if (!checkWin()) save();
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
  if (Gr.man(c.px, c.py, f.x, f.y) > p.rng) return;
  G.player.potions.splice(c.potIdx, 1);
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
  if (!ch || Gr.man(c.px, c.py, x, y) !== 1) return;
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
    const id = rollDropGear(r, c.row <= 2 ? 1 : 2);
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
  if (c.ap < sk.ap) return 'Need AP';
  if (G.player.mp < sk.mp) return 'Need MP';
  if ((sk.tgt === 'foe' || sk.tgt === 'burst') &&
      !c.foes.some(f => !f.dead && Gr.man(c.px, c.py, f.x, f.y) <= sk.rng)) return 'No target';
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
      return !f.dead && Gr.man(c.px, c.py, f.x, f.y) <= sk.rng;
    });
  }
  if (sk.tgt === 'tile') {
    const out = [];
    for (let y = 0; y < Gr.CH; y++) for (let x = 0; x < Gr.CW; x++) {
      if (Gr.open(c, x, y) && Gr.man(c.px, c.py, x, y) <= sk.rng) out.push({ x, y });
    }
    return out;
  }
  return [];
}

export function castSkill(slot, tx, ty) {
  const c = C();
  if (!c || c.phase !== 'player') return;
  const sk = skillFor(slot);
  if (!sk || c.ap < sk.ap || G.player.mp < sk.mp) return;
  const P = G.player, w = getPrimary();
  const fi = tx === undefined ? -1 : foeIdxAt(c, tx, ty);
  const f = fi >= 0 ? c.foes[fi] : null;
  if (sk.tgt === 'foe' && (!f || Gr.man(c.px, c.py, tx, ty) > sk.rng)) return;

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
    if (!Gr.open(c, tx, ty) || Gr.man(c.px, c.py, tx, ty) > sk.rng) return;
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
    const hits = c.foes.filter(q => !q.dead && Gr.man(c.px, c.py, q.x, q.y) <= sk.rng);
    if (!hits.length) return;
    for (const q of hits) {
      hitFoe(q, sk.fx === 'whirl' ? Math.max(1, w.dmg + ri(G.rng, -1, 1)) : sk.v, false);
      if (sk.fx === 'nova' && !q.dead) { q.stun = 1; FX.push({ tx: q.x, ty: q.y, v: '🧊', c: 'blk' }); }
    }
  }

  c.ap -= sk.ap;
  P.mp -= sk.mp;
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
    if (ch && !ch.opened && Gr.man(c.px, c.py, x, y) === 1) { openChestAt(x, y); return; }
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
    return !f.dead && Gr.man(c.px, c.py, f.x, f.y) <= w.rng;
  });
}

export function bombTargets() {
  const c = C();
  if (!c || c.mode !== 'bomb') return [];
  const id = G.player.potions[c.potIdx];
  if (!id) return [];
  return c.foes.map((f, i) => i).filter(i => {
    const f = c.foes[i];
    return !f.dead && Gr.man(c.px, c.py, f.x, f.y) <= POTIONS[id].rng;
  });
}

// ---------- enemy turn ----------
export function endTurn() {
  const c = C();
  if (!c || c.phase !== 'player') return;
  c.mode = 'move';
  c.info = -1;
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
  while (c.ei < c.foes.length && c.foes[c.ei].dead) { c.ei++; c.eap = -1; }
  if (c.ei >= c.foes.length) { startPlayerTurn(); return; }
  const f = c.foes[c.ei], m = MONSTERS[f.mid];

  if (c.eap < 0) { // activation beat: block fades, poison ticks, stun checks
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
        return;
      }
    }
    if (f.stun > 0) {
      f.stun--;
      FX.push({ tx: f.x, ty: f.y, v: '🧊', c: 'blk' });
      log(`${m.name} is frozen solid!`);
      c.ei++;
      c.eap = -1;
      return;
    }
    c.eap = m.ap;
    save();
    return;
  }

  const dist = Gr.man(f.x, f.y, c.px, c.py);
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
}
