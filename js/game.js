// Run state, map generation, items, inventory, crafting, events, shop, save/load.
// G is the single mutable game-state object; everything in it must stay JSON-safe
// (plain objects/arrays/numbers/strings only) so save/load keeps working.
import { makeRng, rnd, ri, pick, chance } from './rng.js';
import { WEAPONS, OFFHANDS, ARMOR, POTIONS, SKILLS, RECIPES, getItem } from './data.js';
import { startCombat } from './combat.js';

export const G = { screen: 'TITLE' };
const KEY = 'depths_save_2';
export const BAG_MAX = 12, POT_MAX = 3;
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
    if (!d || d.v !== 2 || !d.player) return false;
    resetG();
    Object.assign(G, d);
    if (G.combat) G.combat._due = 0; // performance.now() restarts every page load
    return true;
  } catch (e) { return false; }
}

export function goto(s) { G.screen = s; save(); }

export function boot() {
  try { if (hasStore()) localStorage.removeItem('depths_save_1'); } catch (e) {} // pre-tactical saves
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
  G.v = 2;
  G.rng = makeRng(seed);
  G.map = genMap(G.rng);
  G.cur = -1;
  G.player = {
    hp: 60, maxHp: 60, mp: 10, maxMp: 10, apMax: 4,
    gold: 25, scrap: 4,
    primary: 'w_club', secondary: 's_wood', armor: null,
    potions: ['p_heal', 'p_mana'],
    bag: [],
    known: ['sk_power', 'sk_heal'],
    eq: ['sk_power', 'sk_heal'],
  };
  G.stats = { kills: 0, goldEarned: 0, floor: 0 };
  G.combat = null;
  G.pending = null;
  G.shop = null;
  G.back = null;
  G.screen = 'MAP';
  save();
}

// ---- equipped gear ----
export function getPrimary() { return WEAPONS[G.player.primary] || { name: 'Fists', emoji: '👊', dmg: 2, ap: 1, rng: 1, tier: 0 }; }
export function getSecondary() { return OFFHANDS[G.player.secondary] || { name: 'Bare Hand', emoji: '🖐️', block: 0, tier: 0 }; }
export function getArmor() { return ARMOR[G.player.armor] || { name: 'No Armor', emoji: '🧺', def: 0, tier: 0 }; }

// ---- map generation ----
// 8 rows bottom-to-top: row 0 = easy fights, row 6 = guaranteed campfire event, row 7 = boss.
const ROWS = 8;

function rollType(r) {
  const x = rnd(r);
  if (x < 0.42) return 'FIGHT';
  if (x < 0.60) return 'EVENT';
  if (x < 0.76) return 'TREASURE';
  if (x < 0.88) return 'SHOP';
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
      const type = row === 0 ? 'FIGHT' : row === 6 ? 'EVENT' : row === 7 ? 'BOSS' : rollType(r);
      const node = { i: nodes.length, r: row, x: Math.round(x), y: 618 - row * 74, type, next: [], done: false };
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
  else if (n.type === 'BOSS') startCombat('boss', n.r);
  else if (n.type === 'EVENT') resolveEvent(n.r);
  else if (n.type === 'TREASURE') { G.pending = makeTreasure(n.r); goto('CHOICE'); }
  else if (n.type === 'SHOP') openShop(n.r, false);
}

// ---- inventory / bag ----
export function scrapValue(g) { return 1 + (g.tier || 1); }
export function sellPrice(g) { return Math.max(2, Math.floor((g.price || 10) * 0.4)); }

// Returns 'bag' or, when full, converts to scrap and returns 'scrap'.
export function addGearToBag(id) {
  if (G.player.bag.length >= BAG_MAX) {
    G.player.scrap += scrapValue(getItem(id));
    return 'scrap';
  }
  G.player.bag.push(id);
  return 'bag';
}

export function equipFromBag(i) {
  const id = G.player.bag[i];
  const g = getItem(id);
  if (!g) return;
  const slot = g.cat === 'w' ? 'primary' : g.cat === 's' ? 'secondary' : g.cat === 'a' ? 'armor' : null;
  if (!slot) return;
  const old = G.player[slot];
  G.player[slot] = id;
  if (old) G.player.bag[i] = old;
  else G.player.bag.splice(i, 1);
  save();
}

export function scrapFromBag(i) {
  const g = getItem(G.player.bag[i]);
  if (!g) return;
  G.player.scrap += scrapValue(g);
  G.player.bag.splice(i, 1);
  save();
}

// ---- skills ----
export function learnSkill(id) {
  const p = G.player;
  if (!SKILLS[id] || p.known.includes(id)) return;
  p.known.push(id);
  const e = p.eq.indexOf(null);
  if (e >= 0) p.eq[e] = id;
  save();
}

export function toggleSkill(id) {
  const eq = G.player.eq;
  if (!G.player.known.includes(id)) return;
  const j = eq.indexOf(id);
  if (j >= 0) eq[j] = null;
  else {
    const e = eq.indexOf(null);
    if (e >= 0) eq[e] = id;
    else { eq[0] = eq[1]; eq[1] = id; }
  }
  save();
}

// ---- crafting ----
export function craftIssue(rec) {
  const out = getItem(rec.out);
  if (G.player.scrap < rec.scrap) return 'Need scrap';
  if (out.cat === 'k' && G.player.known.includes(out.id)) return 'Known';
  if (out.cat === 'p' && G.player.potions.length >= POT_MAX) return 'Belt full';
  if ((out.cat === 'w' || out.cat === 's' || out.cat === 'a') && G.player.bag.length >= BAG_MAX) return 'Bag full';
  return null;
}

export function craftItem(i) {
  const rec = RECIPES[i];
  if (!rec || craftIssue(rec)) return;
  const out = getItem(rec.out);
  G.player.scrap -= rec.scrap;
  if (out.cat === 'k') learnSkill(out.id);
  else if (out.cat === 'p') G.player.potions.push(out.id);
  else G.player.bag.push(out.id);
  save();
}

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
  const pool = [...Object.values(WEAPONS), ...Object.values(OFFHANDS), ...Object.values(ARMOR)]
    .filter(g => g.tier >= lo && g.tier <= hi);
  return pick(r, pool.length ? pool : Object.values(WEAPONS));
}

export function gearDesc(g) {
  if (g.cat === 'w') return `${g.dmg} dmg · rng ${g.rng} · ${g.ap} AP`;
  if (g.cat === 's') return `+${g.block} block on defend${g.thorns ? ` · ${g.thorns} thorns` : ''}`;
  if (g.cat === 'a') return `${g.def} DEF (reduces every hit)`;
  return g.desc || '';
}

function gearOption(r, row, bonus) {
  const g = rollGear(r, row, bonus);
  return { emoji: g.emoji, label: g.name, desc: `T${g.tier} · ${gearDesc(g)}`, act: { t: 'gear', id: g.id } };
}

function potionOption(r) {
  const p = POTIONS[rollPotionId(r)];
  return { emoji: p.emoji, label: p.name, desc: p.desc, act: { t: 'potion', id: p.id } };
}

function itemOption(r, row, bonus) {
  const x = rnd(r);
  if (x < 0.4) return gearOption(r, row, bonus);
  if (x < 0.7) return potionOption(r);
  if (x < 0.9) { const v = ri(r, 4, 7); return { emoji: '🔩', label: `${v} Scrap`, desc: 'For crafting', act: { t: 'scrap', v } }; }
  const v = ri(r, 12, 20);
  return { emoji: '💰', label: `${v} Gold`, desc: 'Shiny', act: { t: 'gold', v } };
}

// ---- choice screens (loot / events share one UI) ----
function makeTreasure(row) {
  return {
    kind: 'loot', title: '💰 Treasure!', sub: 'Choose one to take',
    options: [gearOption(G.rng, row, 1), itemOption(G.rng, row, 0), itemOption(G.rng, row, 0)],
    canSkip: 'Leave it',
  };
}

function makeCampfire() {
  return {
    kind: 'rest', title: '⛺ Campfire', sub: 'A safe moment in the dark',
    options: [
      { emoji: '🔥', label: 'Rest', desc: 'Heal 26 HP', act: { t: 'heal', v: 26 } },
      { emoji: '💪', label: 'Train', desc: '+6 Max HP, permanently', act: { t: 'maxhp', v: 6 } },
      { emoji: '🧘', label: 'Focus', desc: '+3 Max MP, permanently', act: { t: 'maxmp', v: 3 } },
    ],
    canSkip: 'Move on',
  };
}

function makeShrine() {
  const unknown = Object.keys(SKILLS).filter(id => !G.player.known.includes(id));
  const options = [
    { emoji: '🙏', label: 'Blood Offering', desc: '+6 Max HP', act: { t: 'buy', price: 15, inner: { t: 'maxhp', v: 6 } } },
  ];
  if (unknown.length) {
    const id = pick(G.rng, unknown);
    const sk = SKILLS[id];
    options.push({
      emoji: '📜', label: `Learn ${sk.name}`, desc: sk.desc,
      act: { t: 'scrapbuy', scrap: 10, inner: { t: 'skill', id } },
    });
  }
  return { kind: 'shrine', title: '⛩️ Forgotten Shrine', sub: 'The old gods still listen', options, canSkip: 'Leave' };
}

function makeCache(row) {
  return {
    kind: 'loot', title: '📦 Abandoned Cache', sub: 'Someone left in a hurry',
    options: [itemOption(G.rng, row, 1), itemOption(G.rng, row, 0)],
    canSkip: 'Leave it',
  };
}

function resolveEvent(row) {
  if (row === 6) { G.pending = makeCampfire(); goto('CHOICE'); return; }
  const x = rnd(G.rng);
  if (x < 0.3) { G.pending = makeCampfire(); goto('CHOICE'); }
  else if (x < 0.5) { G.pending = makeCache(row); goto('CHOICE'); }
  else if (x < 0.65) openShop(row, true);
  else if (x < 0.8) { G.pending = makeShrine(); goto('CHOICE'); }
  else startCombat('ambush', row);
}

// ---- shop (buy + sell) ----
function shopGear(r, row) {
  const lo = row <= 2 ? 1 : row <= 4 ? 2 : 3;
  const table = rnd(r) < 0.6 ? WEAPONS : rnd(r) < 0.5 ? OFFHANDS : ARMOR;
  const pool = Object.values(table).filter(g => g.tier >= lo && g.tier <= lo + 2);
  return pick(r, pool.length ? pool : Object.values(table));
}

function stockGear(r, row) {
  const g = shopGear(r, row);
  return { t: 'gear', id: g.id, emoji: g.emoji, name: g.name, desc: `T${g.tier} · ${gearDesc(g)}`, price: Math.max(6, g.price + ri(r, -3, 4)), sold: false };
}

export function openShop(row, wandering) {
  const r = G.rng;
  const p1 = POTIONS[rollPotionId(r)];
  const stock = [
    { t: 'potion', id: p1.id, emoji: p1.emoji, name: p1.name, desc: p1.desc, price: Math.max(5, p1.price + ri(r, -3, 3)), sold: false },
    chance(r, 0.5)
      ? (() => { const p2 = POTIONS[rollPotionId(r)]; return { t: 'potion', id: p2.id, emoji: p2.emoji, name: p2.name, desc: p2.desc, price: Math.max(5, p2.price + ri(r, -3, 3)), sold: false }; })()
      : { t: 'scrap', v: 5, emoji: '🔩', name: 'Scrap Bundle', desc: '5 scrap for crafting', price: 14, sold: false },
    stockGear(r, row),
    stockGear(r, row),
  ];
  G.shop = { title: wandering ? '❓ Wandering Trader' : '🛒 Merchant', stock, tab: 'buy' };
  goto('SHOP');
}

export function shopBuyIssue(i) {
  const s = G.shop && G.shop.stock[i];
  if (!s) return 'gone';
  if (s.sold) return 'SOLD';
  if (G.player.gold < s.price) return 'Not enough gold';
  if (s.t === 'potion' && G.player.potions.length >= POT_MAX) return 'Belt full';
  if (s.t === 'gear' && G.player.bag.length >= BAG_MAX) return 'Bag full';
  return null;
}

export function shopBuy(i) {
  if (shopBuyIssue(i)) return;
  const s = G.shop.stock[i];
  G.player.gold -= s.price;
  if (s.t === 'potion') G.player.potions.push(s.id);
  else if (s.t === 'gear') G.player.bag.push(s.id);
  else if (s.t === 'scrap') G.player.scrap += s.v;
  s.sold = true;
  save();
}

export function shopSell(bagIdx) {
  const g = getItem(G.player.bag[bagIdx]);
  if (!g) return;
  G.player.gold += sellPrice(g);
  G.stats.goldEarned += sellPrice(g);
  G.player.bag.splice(bagIdx, 1);
  save();
}

export function shopLeave() {
  G.shop = null;
  goto('MAP');
}

// ---- choice plumbing ----
export function optionDisabled(o) {
  if (o.sold) return 'SOLD';
  const a = o.act.t === 'buy' || o.act.t === 'scrapbuy' ? o.act.inner : o.act;
  if (a.t === 'potion' && G.player.potions.length >= POT_MAX) return 'Belt full';
  if (a.t === 'gear' && G.player.bag.length >= BAG_MAX) return 'Bag full';
  if (a.t === 'skill' && G.player.known.includes(a.id)) return 'Known';
  if (o.act.t === 'buy' && G.player.gold < o.act.price) return 'Not enough gold';
  if (o.act.t === 'scrapbuy' && G.player.scrap < o.act.scrap) return 'Not enough scrap';
  return null;
}

function applyAct(a) {
  const p = G.player;
  if (a.t === 'gear') addGearToBag(a.id);
  else if (a.t === 'potion') p.potions.push(a.id);
  else if (a.t === 'heal') p.hp = Math.min(p.maxHp, p.hp + a.v);
  else if (a.t === 'maxhp') { p.maxHp += a.v; p.hp += a.v; }
  else if (a.t === 'maxmp') { p.maxMp += a.v; p.mp += a.v; }
  else if (a.t === 'gold') { p.gold += a.v; G.stats.goldEarned += a.v; }
  else if (a.t === 'scrap') p.scrap += a.v;
  else if (a.t === 'skill') learnSkill(a.id);
  else if (a.t === 'buy') { p.gold -= a.price; applyAct(a.inner); }
  else if (a.t === 'scrapbuy') { p.scrap -= a.scrap; applyAct(a.inner); }
}

export function pickOption(i) {
  const pend = G.pending;
  if (!pend) return;
  const o = pend.options[i];
  if (!o || optionDisabled(o)) return;
  applyAct(o.act);
  G.pending = null;
  goto('MAP');
}

export function skipOption() { G.pending = null; goto('MAP'); }

// ---- post-combat rewards ----
export function afterCombatVictory(c) {
  const d = c.drops;
  const gold = d.gold + ri(G.rng, 4, 8) + c.row;
  G.player.gold += gold;
  G.stats.goldEarned += gold;
  G.player.scrap += d.scrap;
  const notes = [];
  for (const id of d.gear) {
    const g = getItem(id);
    const where = addGearToBag(id);
    notes.push(`${g.emoji} ${g.name}${where === 'scrap' ? ' → 🔩' : ''}`);
  }
  const options = [];
  const unknown = Object.keys(SKILLS).filter(id => !G.player.known.includes(id));
  const skillChance = 0.22 + (c.kind === 'ambush' ? 0.15 : 0) + (c.row >= 4 ? 0.08 : 0);
  if (unknown.length && chance(G.rng, skillChance)) {
    const id = pick(G.rng, unknown);
    const sk = SKILLS[id];
    options.push({ emoji: '📜', label: `Learn ${sk.name}`, desc: `${sk.desc} · ${sk.ap} AP ${sk.mp} MP`, act: { t: 'skill', id } });
  }
  G.combat = null;
  G.pending = {
    kind: 'loot', title: '🏆 Victory!',
    sub: `+${gold} 💰   +${d.scrap} 🔩`,
    notes,
    options,
    canSkip: 'Continue',
  };
  goto('CHOICE');
}
