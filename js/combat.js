// Turn-based combat. Block expires after the opponent's next turn (Slay-the-Spire style).
// Potions are free actions. FX is a render-side event queue drained by screens.js.
import { G, save, goto, clearSave, afterCombatRewards, playerWeapon, playerArmor } from './game.js';
import { MONSTERS, POTIONS } from './data.js';
import { ri, pick } from './rng.js';

const POOLS = { easy: [], med: [], elite: [], boss: [] };
for (const [id, m] of Object.entries(MONSTERS)) POOLS[m.pool].push(id);

export const FX = [];

const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);

function log(s) {
  const c = G.combat;
  c.lines.push(s);
  if (c.lines.length > 2) c.lines.shift();
}

export function startCombat(kind, row) {
  const poolName = kind === 'boss' ? 'boss' : kind === 'elite' ? 'elite' : row <= 2 ? 'easy' : 'med';
  const mid = pick(G.rng, POOLS[poolName]);
  const m = MONSTERS[mid];
  G.combat = {
    mid, kind, ehp: m.hp, emax: m.hp, eblock: 0, ebuff: 0, pi: 0,
    pBlock: 0, pStr: 0, phase: 'player', turn: 1,
    lines: [`A ${m.name} appears!`], _due: 0,
  };
  goto('COMBAT');
}

export function intent() {
  const c = G.combat;
  const m = MONSTERS[c.mid];
  const mv = m.pattern[c.pi % m.pattern.length];
  if (mv.t === 'a') return { icon: (mv.m || 1) > 1 ? '💥' : '⚔️', txt: `${(m.atk + c.ebuff) * (mv.m || 1)}` };
  if (mv.t === 'd') return { icon: '🛡️', txt: `${mv.b}` };
  return { icon: '💢', txt: `+${mv.a}` };
}

function endPlayerTurn() {
  const c = G.combat;
  c.phase = 'enemy';
  c._due = now() + 550;
  save();
}

function winCombat() {
  const c = G.combat;
  const kind = c.kind;
  const row = G.map.nodes[G.cur].r;
  G.stats.kills++;
  G.combat = null;
  if (kind === 'boss') { G.won = true; clearSave(); G.screen = 'VICTORY'; return; }
  afterCombatRewards(kind, row);
}

function die() {
  G.player.hp = 0;
  G.dead = true;
  clearSave();
  G.screen = 'GAMEOVER';
}

export function doAttack() {
  const c = G.combat;
  if (!c || c.phase !== 'player') return;
  const dmg = Math.max(1, G.player.baseAtk + playerWeapon().atk + c.pStr + ri(G.rng, -1, 1));
  const blocked = Math.min(c.eblock, dmg);
  c.eblock -= blocked;
  const dealt = dmg - blocked;
  c.ehp -= dealt;
  FX.push({ t: 'e', v: dealt > 0 ? `-${dealt}` : 'Blocked' });
  log(dealt > 0 ? `You hit for ${dealt}.` : 'Your attack was blocked!');
  if (c.ehp <= 0) { winCombat(); return; }
  endPlayerTurn();
}

export function doDefend() {
  const c = G.combat;
  if (!c || c.phase !== 'player') return;
  const gain = 8 + playerArmor().def * 2;
  c.pBlock += gain;
  FX.push({ t: 'pb', v: `+${gain} 🛡️` });
  log(`You brace for impact (+${gain} block).`);
  endPlayerTurn();
}

export function usePotion(i) {
  const c = G.combat;
  if (!c || c.phase !== 'player') return;
  const id = G.player.potions[i];
  if (!id) return;
  const p = G.player;
  p.potions.splice(i, 1);
  if (id === 'p_heal') { p.hp = Math.min(p.maxHp, p.hp + 18); FX.push({ t: 'ph', v: '+18 ❤️' }); }
  else if (id === 'p_bomb') { c.ehp -= 15; FX.push({ t: 'e', v: '-15 💥' }); }
  else if (id === 'p_str') { c.pStr += 3; FX.push({ t: 'ps', v: '+3 ⚔️' }); }
  else if (id === 'p_shield') { c.pBlock += 12; FX.push({ t: 'pb', v: '+12 🛡️' }); }
  else if (id === 'p_life') { p.maxHp += 8; p.hp += 8; FX.push({ t: 'ph', v: '+8 Max ❤️' }); }
  log(`You use a ${POTIONS[id].name}.`);
  if (c.ehp <= 0) { winCombat(); return; }
  save();
}

// Called every frame; runs the enemy's move ~half a second after the player acts.
export function tick(t) {
  const c = G.combat;
  if (!c || G.screen !== 'COMBAT' || c.phase !== 'enemy') return;
  if (!c._due || c._due > t + 3000) c._due = t + 500; // stale timestamp after reload
  if (t >= c._due) enemyAct();
}

function enemyAct() {
  const c = G.combat;
  const m = MONSTERS[c.mid];
  c.eblock = 0;
  const mv = m.pattern[c.pi % m.pattern.length];
  c.pi++;
  if (mv.t === 'a') {
    const raw = Math.max(1, (m.atk + c.ebuff) * (mv.m || 1) + ri(G.rng, -1, 1));
    const blocked = Math.min(c.pBlock, raw);
    c.pBlock -= blocked;
    let dealt = raw - blocked;
    if (dealt > 0) dealt = Math.max(1, dealt - playerArmor().def);
    G.player.hp -= dealt;
    FX.push({ t: 'p', v: dealt > 0 ? `-${dealt}` : 'Blocked!' });
    log(dealt > 0 ? `${m.name} hits you for ${dealt}.` : `You block the attack!`);
    if (G.player.hp <= 0) { die(); return; }
  } else if (mv.t === 'd') {
    c.eblock += mv.b;
    FX.push({ t: 'eb', v: `+${mv.b} 🛡️` });
    log(`${m.name} raises its guard.`);
  } else {
    c.ebuff += mv.a;
    FX.push({ t: 'ebf', v: `+${mv.a} 💢` });
    log(`${m.name} rages (+${mv.a} ATK).`);
  }
  c.pBlock = 0;
  c.phase = 'player';
  c.turn++;
  save();
}
