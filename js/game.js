// Run state, map generation, items, choices, save/load.
// G is the single mutable game-state object; everything in it must stay JSON-safe
// (plain objects/arrays/numbers/strings only) so save/load keeps working.
import { makeRng, rnd, ri, pick, chance } from './rng.js';
import { WEAPONS, ARMOR, POTIONS } from './data.js';
import { startCombat } from './combat.js';

export const G = { screen: 'TITLE' };
const KEY = 'depths_save_1';
const hasStore = () => typeof localStorage !== 'undefined';

export function save() {
  try { if (hasStore()) localStorage.setItem(KEY, JSON.stringify(G)); } catch (e) { /* storage blocked/full */ }
}
export function clearSave() {
  try { if (hasStore()) localStorage.removeItem(KEY); } catch (e) {}
}
function resetG() {
  for (const k of Object.keys(G)) delete G[k];
}
export function loadSave() {
  try {
    if (!hasStore()) return false;
    const s = localStorage.getItem(KEY);
    if (!s) return false;
    const d = JSON.parse(s);
    if (!d || d.v !== 1 || !d.player) return false;
    resetG();
    Object.assign(G, d);
    if (G.combat) G.combat._due = 0; // performance.now() restarts every page load
    return true;
  } catch (e) { return false; }
}

export function goto(s) { G.screen = s; save(); }

export function boot() {
  if (loadSave() && G.player.hp > 0 && !G.dead && !G.won) {
    G.back = (G.screen !== 'TITLE') ? G.screen : (G.back || 'MAP');
  } else {
    G.back = null;
  }
  G.screen = 'TITLE';
}

export function canContinue() {
  return !!(G.back && G.player && G.player.hp > 0 && !G.dead && !G.won);
}
export function continueRun() {
  if (!canContinue()) return;
  G.screen = G.back;
  save();
}

export function newRun() {
  const seed = ((Date.now() % 2147483647) ^ Math.floor(Math.random() * 2147483647)) >>> 0;
  resetG();
  G.v = 1;
  G.rng = makeRng(seed);
  G.map = genMap(G.rng);
  G.cur = -1;
  G.player = { hp: 55, maxHp: 55, baseAtk: 3, gold: 20, weapon: 'w_dagger', armor: null, potions: ['p_heal'] };
  G.stats = { kills: 0, goldEarned: 0, floor: 0 };
  G.combat = null;
  G.pending = null;
  G.back = null;
  G.screen = 'MAP';
  save();
}

// ---- map generation ----
// 8 rows bottom-to-top: row 0 = easy fights, row 6 = campfires, row 7 = boss.
const ROWS = 8;

function rollType(r, row) {
  const x = rnd(r);
  if (x < 0.11) return row >= 3 ? 'ELITE' : 'FIGHT';
  if (x < 0.24) return 'TREASURE';
  if (x < 0.36) return 'SHOP';
  if (x < 0.49) return 'REST';
  return 'FIGHT';
}

function genMap(r) {
  const nodes = [];
  const rows = [];
  for (let row = 0; row < ROWS; row++) {
    const n = row === 7 ? 1 : row === 6 ? 2 : row === 0 ? ri(r, 2, 3) : ri(r, 2, 4);
    const list = [];
    for (let c = 0; c < n; c++) {
      const x = n === 1 ? 210 : 70 + 280 * (c / (n - 1)) + (row < 7 ? ri(r, -12, 12) : 0);
      const type = row === 0 ? 'FIGHT' : row === 6 ? 'REST' : row === 7 ? 'BOSS' : rollType(r, row);
      const node = { i: nodes.length, r: row, x: Math.round(x), y: 640 - row * 80, type, next: [], done: false };
      nodes.push(node);
      list.push(node);
    }
    rows.push(list);
  }
  for (let row = 0; row < ROWS - 1; row++) {
    const a = rows[row], b = rows[row + 1];
    for (let j = 0; j < a.length; j++) {
      const t = a.length === 1 ? Math.floor((b.length - 1) / 2) : Math.round(j * (b.length - 1) / (a.length - 1));
      a[j].next.push(b[t].i);
      if (b.length > 1 && chance(r, 0.35)) {
        const t2 = Math.min(b.length - 1, Math.max(0, t + (chance(r, 0.5) ? 1 : -1)));
        if (t2 !== t) a[j].next.push(b[t2].i);
      }
    }
    for (const top of b) {
      if (!a.some(n => n.next.includes(top.i))) {
        let best = a[0];
        for (const n of a) if (Math.abs(n.x - top.x) < Math.abs(best.x - top.x)) best = n;
        best.next.push(top.i);
      }
    }
    for (const n of a) n.next = [...new Set(n.next)];
  }
  return { nodes };
}

export function reachable() {
  if (!G.map) return [];
  if (G.cur < 0) return G.map.nodes.filter(n => n.r === 0).map(n => n.i);
  return G.map.nodes[G.cur].next;
}

export function enterNode(i) {
  if (!reachable().includes(i)) return;
  const n = G.map.nodes[i];
  G.cur = i;
  n.done = true;
  G.stats.floor = Math.max(G.stats.floor, n.r + 1);
  if (n.type === 'FIGHT') startCombat('fight', n.r);
  else if (n.type === 'ELITE') startCombat('elite', n.r);
  else if (n.type === 'BOSS') startCombat('boss', n.r);
  else if (n.type === 'TREASURE') { G.pending = makeTreasure(n.r); goto('CHOICE'); }
  else if (n.type === 'REST') { G.pending = makeRest(); goto('CHOICE'); }
  else if (n.type === 'SHOP') { G.pending = makeShop(n.r); goto('CHOICE'); }
}

// ---- equipped gear ----
export function playerWeapon() { return WEAPONS[G.player.weapon] || { name: 'Fists', emoji: '👊', atk: 0 }; }
export function playerArmor() { return ARMOR[G.player.armor] || { name: 'No Armor', emoji: '🧺', def: 0 }; }

// ---- item rolling ----
function rollPotionId(r) {
  const pool = Object.values(POTIONS);
  let total = 0;
  for (const p of pool) total += p.w;
  let x = rnd(r) * total;
  for (const p of pool) { x -= p.w; if (x <= 0) return p.id; }
  return pool[0].id;
}

function rollGear(r, row, bonus) {
  const lo = Math.min(5, (row <= 2 ? 1 : row <= 4 ? 2 : 3) + bonus);
  const hi = Math.min(5, lo + 1);
  const pool = [...Object.values(WEAPONS), ...Object.values(ARMOR)].filter(g => g.tier >= lo && g.tier <= hi);
  return pick(r, pool.length ? pool : Object.values(WEAPONS));
}

function gearDesc(g) {
  const cur = g.cat === 'w' ? playerWeapon() : playerArmor();
  const stat = g.cat === 'w' ? `ATK +${g.atk}` : `DEF +${g.def}`;
  return `${stat} (you have ${cur.name} +${g.cat === 'w' ? cur.atk : cur.def})`;
}

function itemOption(r, row, bonus) {
  if (chance(r, 0.45)) {
    const p = POTIONS[rollPotionId(r)];
    return { emoji: p.emoji, label: p.name, desc: p.desc, act: { t: 'potion', id: p.id } };
  }
  const g = rollGear(r, row, bonus);
  return { emoji: g.emoji, label: g.name, desc: gearDesc(g), act: { t: 'gear', id: g.id } };
}

// ---- choice screens (loot / rest / shop share one UI) ----
function makeTreasure(row) {
  return {
    kind: 'loot', title: '💰 Treasure!', sub: 'Choose one to take',
    options: [itemOption(G.rng, row, 1), itemOption(G.rng, row, 0), itemOption(G.rng, row, 0)],
    canSkip: 'Leave it',
  };
}

function makeRest() {
  return {
    kind: 'rest', title: '⛺ Campfire', sub: 'A safe moment in the dark',
    options: [
      { emoji: '🔥', label: 'Rest', desc: 'Heal 24 HP', act: { t: 'heal', v: 24 } },
      { emoji: '💪', label: 'Train', desc: '+6 Max HP, permanently', act: { t: 'maxhp', v: 6 } },
    ],
    canSkip: 'Move on',
  };
}

function shopGear(r, row, cat) {
  const lo = row <= 2 ? 1 : row <= 4 ? 2 : 3;
  const hi = lo + 2;
  const table = cat === 'w' ? WEAPONS : ARMOR;
  const pool = Object.values(table).filter(g => g.tier >= lo && g.tier <= hi);
  return pick(r, pool.length ? pool : Object.values(table));
}

function makeShop(row) {
  const priced = (g) => ({
    emoji: g.emoji, label: g.name, desc: gearDesc(g),
    act: { t: 'buy', price: Math.max(5, g.price + ri(G.rng, -4, 5)), inner: { t: 'gear', id: g.id } },
  });
  const p = POTIONS[rollPotionId(G.rng)];
  return {
    kind: 'shop', title: '🛒 Merchant', sub: '“Spend it now — gold buys nothing in the grave.”',
    options: [
      { emoji: p.emoji, label: p.name, desc: p.desc, act: { t: 'buy', price: Math.max(5, p.price + ri(G.rng, -4, 5)), inner: { t: 'potion', id: p.id } } },
      priced(shopGear(G.rng, row, 'w')),
      priced(shopGear(G.rng, row, 'a')),
    ],
    canSkip: '🚪 Leave',
  };
}

export function optionDisabled(o) {
  if (o.sold) return 'SOLD';
  const a = o.act.t === 'buy' ? o.act.inner : o.act;
  if (a.t === 'potion' && G.player.potions.length >= 3) return 'Potions full';
  if (o.act.t === 'buy' && G.player.gold < o.act.price) return 'Not enough gold';
  return null;
}

function applyAct(a) {
  const p = G.player;
  if (a.t === 'gear') { if (WEAPONS[a.id]) p.weapon = a.id; else p.armor = a.id; }
  else if (a.t === 'potion') p.potions.push(a.id);
  else if (a.t === 'heal') p.hp = Math.min(p.maxHp, p.hp + a.v);
  else if (a.t === 'maxhp') { p.maxHp += a.v; p.hp += a.v; }
  else if (a.t === 'buy') { p.gold -= a.price; applyAct(a.inner); }
}

export function pickOption(i) {
  const pend = G.pending;
  if (!pend) return;
  const o = pend.options[i];
  if (!o || optionDisabled(o)) return;
  applyAct(o.act);
  if (pend.kind === 'shop') { o.sold = true; save(); }
  else { G.pending = null; goto('MAP'); }
}

export function skipOption() { G.pending = null; goto('MAP'); }

export function afterCombatRewards(kind, row) {
  const gold = kind === 'elite' ? ri(G.rng, 22, 32) : ri(G.rng, 8, 14);
  G.player.gold += gold;
  G.stats.goldEarned += gold;
  const options = [];
  if (kind === 'elite') options.push(itemOption(G.rng, row, 1), itemOption(G.rng, row, 0));
  else if (chance(G.rng, 0.6)) options.push(itemOption(G.rng, row, 0));
  if (options.length) {
    G.pending = { kind: 'loot', title: '🏆 Victory!', sub: `You loot 💰${gold} gold`, options, canSkip: 'Skip' };
    goto('CHOICE');
  } else {
    goto('MAP');
  }
}
