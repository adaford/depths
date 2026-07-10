// Headless simulation: plays full runs with a competent policy and checks invariants.
// Run with: node test/smoke.mjs
// The win-rate it prints is the difficulty gauge — keep it roughly in the 15–45%
// band when tuning content in js/data.js.
import {
  G, newRun, reachable, enterNode, pickOption, skipOption, optionDisabled,
  getPrimary, getSecondary, getArmor, equipFromBag, scrapFromBag,
  craftIssue, craftItem, shopBuy, shopBuyIssue, shopSell, shopLeave,
  BAG_MAX, POT_MAX,
} from '../js/game.js';
import {
  tick, moveTo, attackFoe, castSkill, defend, endTurn, usePotion, throwBomb,
  openChestAt, atkTargets, skillTargets, skillFor, skillIssue, beginBattle,
} from '../js/combat.js';
import { WEAPONS, OFFHANDS, ARMOR, SKILLS, RECIPES, getItem } from '../js/data.js';
import { cheb, k, wallAt, chestAt, obsAt, stepToward } from '../js/grid.js';

let tt = 1000;
const counts = { crafts: 0, sold: 0, scrapped: 0, chests: 0, skillsLearned: 0 };

function fail(msg) {
  console.error('SMOKE FAIL:', msg, JSON.stringify({
    screen: G.screen, hp: G.player && G.player.hp, cur: G.cur,
    combat: G.combat && { turn: G.combat.turn, phase: G.combat.phase, ap: G.combat.ap, foes: G.combat.foes.map(f => [f.mid, f.hp, f.x, f.y]) },
  }));
  process.exit(1);
}

// ---- invariants ----
function checkInvariants() {
  const p = G.player;
  if (!p) return;
  if (p.hp > p.maxHp) fail('hp above max');
  if (p.gold < 0) fail('negative gold');
  if (p.scrap < 0) fail('negative scrap');
  if (p.mp < 0 || p.mp > p.maxMp) fail('mp out of range');
  if (p.potions.length > POT_MAX) fail('potion overflow');
  if (p.bag.length > BAG_MAX) fail('bag overflow');
  const c = G.combat;
  if (c && G.screen === 'COMBAT') {
    if (c.ap < 0) fail('negative AP');
    if (c.turn > 120) fail('combat stalled past 120 turns');
    const occ = new Set([k(c.px, c.py)]);
    if (wallAt(c, c.px, c.py) || chestAt(c, c.px, c.py) || obsAt(c, c.px, c.py)) fail('player inside obstacle');
    for (const f of c.foes) {
      if (f.dead) continue;
      if (f.x < 0 || f.x >= c.w || f.y < 0 || f.y >= c.h) fail('foe out of bounds');
      if (wallAt(c, f.x, f.y) || chestAt(c, f.x, f.y) || obsAt(c, f.x, f.y)) fail('foe inside obstacle');
      if (occ.has(k(f.x, f.y))) fail('units overlap');
      occ.add(k(f.x, f.y));
    }
  }
}

// ---- gear policy ----
function gearScore(g) {
  if (!g || !g.cat) return 0;
  if (g.cat === 'w') return (g.dmg / g.ap) * 2 + g.rng * 0.4;
  if (g.cat === 's') return g.block + (g.thorns || 0);
  if (g.cat === 'a') return g.def * 2;
  return 0;
}
function equippedFor(cat) {
  return cat === 'w' ? getPrimary() : cat === 's' ? getSecondary() : getArmor();
}

function manageBag() {
  const p = G.player;
  // equip upgrades
  for (let guard = 0; guard < 20; guard++) {
    let bestI = -1, bestGain = 0.01;
    p.bag.forEach((id, i) => {
      const g = getItem(id);
      const gain = gearScore(g) - gearScore(equippedFor(g.cat));
      if (gain > bestGain) { bestGain = gain; bestI = i; }
    });
    if (bestI < 0) break;
    equipFromBag(bestI);
  }
  // scrap the junk when the bag is getting full
  while (p.bag.length > 7) {
    let worstI = 0, worst = Infinity;
    p.bag.forEach((id, i) => {
      const s = gearScore(getItem(id));
      if (s < worst) { worst = s; worstI = i; }
    });
    scrapFromBag(worstI);
    counts.scrapped++;
  }
  // craft an upgrade when scrap allows (prefer expensive = stronger)
  for (let guard = 0; guard < 6; guard++) {
    let bestI = -1, bestGain = 0.5, bestCost = 0;
    RECIPES.forEach((rec, i) => {
      if (craftIssue(rec)) return;
      const out = getItem(rec.out);
      if (out.cat === 'k') { if (G.player.scrap >= rec.scrap + 6) { if (rec.scrap > bestCost) { bestI = i; bestCost = rec.scrap; bestGain = 99; } } return; }
      if (out.cat === 'p') return;
      const gain = gearScore(out) - gearScore(equippedFor(out.cat));
      if (gain > bestGain) { bestGain = gain; bestI = i; bestCost = rec.scrap; }
    });
    if (bestI < 0) break;
    const wasSkill = getItem(RECIPES[bestI].out).cat === 'k';
    craftItem(bestI);
    counts.crafts++;
    if (wasSkill) counts.skillsLearned++;
  }
  // craft potions with leftover scrap
  while (G.player.scrap >= 10 && G.player.potions.length < POT_MAX) {
    const i = RECIPES.findIndex(r => r.out === 'p_heal');
    if (i < 0 || craftIssue(RECIPES[i])) break;
    craftItem(i);
    counts.crafts++;
  }
}

// ---- combat policy ----
function playCombat() {
  const c = G.combat;
  if (c.phase === 'prep') { beginBattle(); return; }
  if (c.phase === 'enemy') {
    c._due = tt;
    tick(tt);
    tt += 1000;
    return;
  }
  const P = G.player;
  const pi = (id) => P.potions.indexOf(id);
  if (P.hp <= P.maxHp * 0.4 && pi('p_heal') >= 0 && c.ap >= 1) { usePotion(pi('p_heal')); return; }
  if (P.mp <= 2 && pi('p_mana') >= 0 && c.ap >= 1 && c.turn > 2) { usePotion(pi('p_mana')); return; }

  const foes = c.foes.map((f, i) => ({ f, i })).filter(x => !x.f.dead);
  if (!foes.length) fail('player phase with no live foes');
  const dist = (f) => cheb(c.px, c.py, f.x, f.y);
  const nearest = foes.reduce((a, b) => (dist(a.f) <= dist(b.f) ? a : b));

  // skills
  for (const slot of [0, 1]) {
    const sk = skillFor(slot);
    if (!sk || skillIssue(slot)) continue;
    if (sk.fx === 'heal') {
      if (P.hp <= P.maxHp * 0.55) { castSkill(slot); return; }
      continue;
    }
    if (sk.fx === 'block' || sk.fx === 'blink' || sk.fx === 'shove') continue; // situational, skip
    if (sk.tgt === 'burst') {
      if (foes.filter(x => dist(x.f) <= sk.rng).length >= 2) { castSkill(slot); return; }
      continue;
    }
    if (sk.tgt === 'foe') {
      const ts = skillTargets(slot);
      if (ts.length && P.mp >= sk.mp + 3) { // keep a little mana buffer
        const t = ts.map(i => c.foes[i]).reduce((a, b) => (a.hp <= b.hp ? a : b));
        castSkill(slot, t.x, t.y);
        return;
      }
    }
  }

  // basic attack: hit the weakest foe in range
  const ts = atkTargets();
  if (ts.length) {
    const weakest = ts.reduce((a, b) => (c.foes[a].hp <= c.foes[b].hp ? a : b));
    attackFoe(weakest);
    return;
  }

  // bomb a distant foe if we can't reach anyone
  if (pi('p_bomb') >= 0 && c.ap >= 1 && foes.some(x => dist(x.f) <= 3)) {
    usePotion(pi('p_bomb'));
    const bt = foes.filter(x => dist(x.f) <= 3);
    if (bt.length && c.mode === 'bomb') { throwBomb(bt[0].i); return; }
  }

  // open an adjacent chest (free value)
  for (const ch of c.chests) {
    if (!ch.opened && cheb(c.px, c.py, ch.x, ch.y) === 1 && c.ap >= 1) {
      openChestAt(ch.x, ch.y);
      counts.chests++;
      return;
    }
  }

  // walk one BFS step toward the closest reachable foe (a sleeping foe can plug a
  // corridor, making foes behind it unreachable — try each in distance order).
  // stepToward already prefers trap-free routes, so a trap step is the only way through.
  if (c.ap >= 1) {
    const byDist = [...foes].sort((a, b) => dist(a.f) - dist(b.f));
    for (const t of byDist) {
      const step = stepToward(c, { x: c.px, y: c.py }, t.f.x, t.f.y);
      if (step) { moveTo(step.x, step.y); return; }
    }
  }

  // nothing better to do: brace if threatened, then end
  if (c.ap >= 1 && !c.defended && foes.some(x => dist(x.f) <= 3)) { defend(); return; }
  endTurn();
}

// ---- choice policy ----
function actScore(o) {
  const P = G.player;
  const a = o.act.t === 'buy' || o.act.t === 'scrapbuy' ? o.act.inner : o.act;
  if (o.act.t === 'buy' && P.gold < o.act.price + 15) return -1; // keep a cushion
  if (o.act.t === 'scrapbuy' && P.scrap < o.act.scrap + 4) return -1;
  if (a.t === 'skill') return 6;
  if (a.t === 'gear') {
    const g = getItem(a.id);
    return 2 + Math.max(0, gearScore(g) - gearScore(equippedFor(g.cat)));
  }
  if (a.t === 'heal') return P.hp <= P.maxHp - a.v ? 5 : 0.2;
  if (a.t === 'potion') return 3;
  if (a.t === 'maxhp') return 2.5;
  if (a.t === 'maxmp') return P.maxMp < 16 ? 2.2 : 0.5;
  if (a.t === 'scrap') return 2;
  if (a.t === 'gold') return 1.5;
  return 0.5;
}

function playChoice() {
  const p = G.pending;
  if (!p) fail('CHOICE screen with no pending choice');
  let bestI = -1, best = 0.4;
  p.options.forEach((o, i) => {
    if (optionDisabled(o)) return;
    const s = actScore(o);
    if (s > best) { best = s; bestI = i; }
  });
  if (bestI >= 0) pickOption(bestI);
  else skipOption();
}

// ---- shop policy ----
function playShop() {
  const P = G.player;
  // sell junk (anything clearly worse than equipped)
  for (let i = P.bag.length - 1; i >= 0; i--) {
    const g = getItem(P.bag[i]);
    if (gearScore(g) <= gearScore(equippedFor(g.cat))) { shopSell(i); counts.sold++; }
  }
  // buy potions and upgrades
  for (let i = 0; i < G.shop.stock.length; i++) {
    const s = G.shop.stock[i];
    if (shopBuyIssue(i)) continue;
    if (s.t === 'potion' && (s.id === 'p_heal' || s.id === 'p_mana')) { shopBuy(i); continue; }
    if (s.t === 'gear') {
      const g = getItem(s.id);
      if (gearScore(g) > gearScore(equippedFor(g.cat)) && P.gold >= s.price + 20) { shopBuy(i); continue; }
    }
    if (s.t === 'scrap' && P.gold >= s.price + 30) shopBuy(i);
  }
  shopLeave();
}

// ---- map policy ----
function nodeScore(n) {
  const hpFrac = G.player.hp / G.player.maxHp;
  switch (n.type) {
    case 'EVENT': return hpFrac < 0.6 ? 3.5 : 2;
    case 'TREASURE': return 3;
    case 'SHOP': return G.player.gold >= 30 ? 2.2 : 0.5;
    default: return 1;
  }
}

// ---- run loop ----
let wins = 0, deaths = 0, floors = 0, turnsTotal = 0, fightsTotal = 0;
const RUNS = 300;

for (let run = 0; run < RUNS; run++) {
  newRun();
  let steps = 0;
  while (G.screen !== 'GAMEOVER' && G.screen !== 'VICTORY') {
    if (++steps > 30000) fail(`run ${run} stuck on screen ${G.screen}`);
    if (G.screen === 'MAP') {
      manageBag();
      const rs = reachable();
      if (!rs.length) fail(`run ${run}: no reachable nodes from ${G.cur}`);
      let best = rs[0];
      for (const i of rs) if (nodeScore(G.map.nodes[i]) > nodeScore(G.map.nodes[best])) best = i;
      enterNode(best);
      if (G.screen === 'COMBAT') fightsTotal++;
    } else if (G.screen === 'CHOICE') {
      playChoice();
    } else if (G.screen === 'COMBAT') {
      const turnBefore = G.combat.turn;
      playCombat();
      if (G.combat && G.combat.turn > turnBefore) turnsTotal++;
    } else if (G.screen === 'SHOP') {
      playShop();
    } else {
      fail(`unexpected screen ${G.screen}`);
    }
    checkInvariants();
  }
  if (G.screen === 'VICTORY') wins++;
  else deaths++;
  floors += G.stats.floor;
}

const rate = Math.round(100 * wins / RUNS);
console.log(`smoke OK — ${RUNS} runs: ${wins} wins (${rate}%), ${deaths} deaths, avg floor ${(floors / RUNS).toFixed(1)}`);
console.log(`  fights ${fightsTotal}, avg enemy turns/fight ${(turnsTotal / Math.max(1, fightsTotal)).toFixed(1)}`);
console.log(`  crafts ${counts.crafts} (skills ${counts.skillsLearned}), sold ${counts.sold}, scrapped ${counts.scrapped}, chests ${counts.chests}`);
if (rate < 5 || rate > 70) {
  console.error(`SMOKE WARN: win rate ${rate}% far outside the 15–45% target band`);
  process.exit(1);
}
