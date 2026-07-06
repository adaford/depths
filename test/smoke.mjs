// Headless simulation: plays full runs with a competent policy and checks invariants.
// Run with: node test/smoke.mjs
// The win-rate it prints is the difficulty gauge — keep it roughly in the 15–45%
// band when tuning content in js/data.js.
import {
  G, newRun, reachable, enterNode, pickOption, skipOption, optionDisabled,
  playerWeapon, playerArmor,
} from '../js/game.js';
import { doAttack, doDefend, usePotion, tick, intent } from '../js/combat.js';
import { WEAPONS, ARMOR } from '../js/data.js';

function fail(msg) {
  console.error('SMOKE FAIL:', msg, JSON.stringify({ screen: G.screen, hp: G.player && G.player.hp, cur: G.cur }));
  process.exit(1);
}

function gearGain(act) {
  const a = act.t === 'buy' ? act.inner : act;
  if (a.t !== 'gear') return 0;
  const g = WEAPONS[a.id] || ARMOR[a.id];
  return g.cat === 'w' ? g.atk - playerWeapon().atk : g.def - playerArmor().def;
}

function nodeScore(n) {
  const hpFrac = G.player.hp / G.player.maxHp;
  switch (n.type) {
    case 'REST': return hpFrac < 0.6 ? 5 : 1;
    case 'TREASURE': return 3;
    case 'SHOP': return G.player.gold >= 25 ? 2 : 0;
    case 'ELITE': return hpFrac > 0.7 ? 2 : -3;
    default: return 1;
  }
}

function playChoice() {
  const p = G.pending;
  if (!p) fail('CHOICE screen with no pending choice');
  const opts = p.options.map((o, i) => ({ o, i })).filter(x => !optionDisabled(x.o));
  let pickIdx = -1, best = 0;
  for (const { o, i } of opts) {
    const v = gearGain(o.act);
    if (v > best) { best = v; pickIdx = i; }
  }
  if (pickIdx < 0) {
    for (const { o, i } of opts) {
      const a = o.act.t === 'buy' ? o.act.inner : o.act;
      if (a.t === 'potion' && (o.act.t !== 'buy' || G.player.gold >= 35)) { pickIdx = i; break; }
      if (a.t === 'heal' && G.player.hp <= G.player.maxHp - 24) { pickIdx = i; break; }
      if (a.t === 'maxhp' && G.player.hp > G.player.maxHp - 24) { pickIdx = i; break; }
    }
  }
  if (pickIdx >= 0) pickOption(pickIdx);
  else skipOption();
}

function playCombat() {
  const c = G.combat;
  if (c.phase !== 'player') { c._due = 1; tick(2); return; }
  const pot = G.player.potions;
  const it = intent();
  const incoming = (it.icon === '⚔️' || it.icon === '💥') ? parseInt(it.txt, 10) : 0;
  const idx = (id) => pot.indexOf(id);
  if (idx('p_life') >= 0) usePotion(idx('p_life'));
  else if (idx('p_heal') >= 0 && G.player.hp <= G.player.maxHp * 0.4) usePotion(idx('p_heal'));
  else if (idx('p_bomb') >= 0 && c.ehp <= 15) usePotion(idx('p_bomb'));
  else if (idx('p_str') >= 0 && c.kind !== 'fight' && c.turn === 1) usePotion(idx('p_str'));
  else if (idx('p_shield') >= 0 && incoming >= 14) usePotion(idx('p_shield'));
  else if (incoming >= 10 && G.player.hp <= incoming + 12) doDefend();
  else doAttack();
}

let wins = 0, deaths = 0, floors = 0;
const RUNS = 300;

for (let run = 0; run < RUNS; run++) {
  newRun();
  let steps = 0;
  while (G.screen !== 'GAMEOVER' && G.screen !== 'VICTORY') {
    if (++steps > 5000) fail(`run ${run} stuck on screen ${G.screen}`);
    if (G.screen === 'MAP') {
      const rs = reachable();
      if (!rs.length) fail(`run ${run}: no reachable nodes from ${G.cur}`);
      let best = rs[0];
      for (const i of rs) if (nodeScore(G.map.nodes[i]) > nodeScore(G.map.nodes[best])) best = i;
      enterNode(best);
    } else if (G.screen === 'CHOICE') {
      playChoice();
    } else if (G.screen === 'COMBAT') {
      playCombat();
    } else {
      fail(`unexpected screen ${G.screen}`);
    }
    const pl = G.player;
    if (pl.hp > pl.maxHp) fail('hp above max');
    if (pl.gold < 0) fail('negative gold');
    if (pl.potions.length > 3) fail('potion overflow');
  }
  if (G.screen === 'VICTORY') wins++; else deaths++;
  floors += G.stats.floor;
}

const rate = Math.round(100 * wins / RUNS);
console.log(`smoke OK — ${RUNS} runs: ${wins} wins (${rate}%), ${deaths} deaths, avg floor reached ${(floors / RUNS).toFixed(1)}`);
