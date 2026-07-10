// All screen rendering. Immediate-mode: each frame redraws and re-registers tap targets.
import * as U from './ui.js';
import {
  G, canContinue, continueRun, newRun, reachable, enterNode,
  pickOption, skipOption, optionDisabled, goto,
  getPrimary, getSecondary, getArmor, gearDesc,
  equipFromBag, scrapFromBag, scrapValue, sellPrice,
  toggleSkill, craftIssue, craftItem,
  shopBuy, shopBuyIssue, shopSell, shopLeave,
  BAG_MAX,
} from './game.js';
import {
  FX, AGRO, tapBoard, setMode, defend, endTurn, usePotion, closeInfo,
  atkTargets, skillTargets, skillFor, skillIssue, bombTargets, castSkill,
  beginBattle, structTargets, foeReach, foeThreatens,
} from './combat.js';
import { MONSTERS, POTIONS, SKILLS, RECIPES, NODE_EMOJI, getItem } from './data.js';
import { reach, k, cheb } from './grid.js';

const GOLD = '#e8b45a', DIM = '#8a8798', TXT = '#e8e4da', RED = '#ff6b5e', BLU = '#7fc7ff', PUR = '#b39dff', GRN = '#7fe08a';

// combat board viewport + camera (module-local render state, never saved)
const T = 64, VX = 4, VY = 40, VW = 412, VH = 474;
let camX = 0, camY = 0, camFree = false, camFocusKey = '', lastC = null;
let aInfo = null; // action detail overlay: {t:'atk'} | {t:'sk',slot} | {t:'def'}

let invPage = 0, skillPage = 0, craftPage = 0, sellPage = 0;

// convert combat events (tile coords) into floating numbers at screen positions
const FXC = { dmg: '#ffd76a', hurt: '#ff7b6b', blk: BLU, heal: GRN, psn: '#a8e06a', gold: GOLD, mp: PUR, buff: '#ff9b6b' };
function drainFX() {
  for (const ev of FX.splice(0)) {
    U.addFloat(VX + ev.tx * T + T / 2 - camX, VY + ev.ty * T + 14 - camY, ev.v, FXC[ev.c] || TXT);
  }
}

export function render(t, dt) {
  U.frameStart();
  if (G.screen !== 'COMBAT') { FX.length = 0; U.floats.length = 0; aInfo = null; }
  drainFX();
  if (G.screen === 'TITLE') title();
  else if (G.screen === 'MAP') map(t);
  else if (G.screen === 'COMBAT') combat(t);
  else if (G.screen === 'CHOICE') choice();
  else if (G.screen === 'SHOP') shop();
  else if (G.screen === 'INV') inv();
  else if (G.screen === 'SKILLS') skills();
  else if (G.screen === 'CRAFT') craft();
  else if (G.screen === 'GAMEOVER') endScreen('💀', 'You Died', '#d9534f');
  else if (G.screen === 'VICTORY') endScreen('👑', 'Victory!', GOLD);
  U.drawFloats(dt);
}

function header(showMenu) {
  const p = G.player;
  U.txt(`Fl ${G.stats.floor}/10`, 14, 26, 14, DIM, 'left');
  U.txt(`❤️${p.hp}/${p.maxHp}`, 132, 26, 14, TXT);
  U.txt(`🔮${p.mp}`, 216, 26, 14, PUR);
  U.txt(`💰${p.gold}`, 278, 26, 14, GOLD);
  U.txt(`🔩${p.scrap}`, 340, 26, 14, DIM);
  if (showMenu) U.button(374, 6, 38, 38, '≡', () => { G.back = 'MAP'; goto('TITLE'); }, { size: 20 });
}

function backBtn() {
  const toCombat = G.ret === 'COMBAT' && G.combat;
  U.button(110, 716, 200, 60, toCombat ? '⚔️ To Battle' : '⬅ Back to Map', () => goto(toCombat ? 'COMBAT' : 'MAP'), { size: 17 });
}

function pager(page, pages, set) {
  if (pages <= 1) return page;
  const p = Math.max(0, Math.min(page, pages - 1));
  U.button(84, 640, 64, 56, '◀', () => set(Math.max(0, p - 1)), { size: 20, disabled: p === 0 });
  U.txt(`${p + 1} / ${pages}`, 210, 668, 15, DIM);
  U.button(272, 640, 64, 56, '▶', () => set(Math.min(pages - 1, p + 1)), { size: 20, disabled: p >= pages - 1 });
  return p;
}

// ---------- map ----------
function map(t) {
  header(true);
  U.txt('Tap a glowing node to travel', 210, 54, 12, DIM);
  const nodes = G.map.nodes;
  const reachIds = reachable();
  U.ctx.lineWidth = 2;
  for (const n of nodes) {
    for (const j of n.next) {
      const m = nodes[j];
      const dx = m.x - n.x, dy = m.y - n.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      U.ctx.strokeStyle = (n.i === G.cur && reachIds.includes(j)) ? GOLD : '#2b2b40';
      U.ctx.beginPath();
      U.ctx.moveTo(n.x + ux * 21, n.y + uy * 21);
      U.ctx.lineTo(m.x - ux * 21, m.y - uy * 21);
      U.ctx.stroke();
    }
  }
  if (G.cur < 0) {
    for (const i of reachIds) {
      const m = nodes[i];
      const dx = m.x - 210, dy = m.y - 674;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      U.ctx.strokeStyle = GOLD;
      U.ctx.beginPath();
      U.ctx.moveTo(210 + ux * 22, 674 + uy * 22);
      U.ctx.lineTo(m.x - ux * 21, m.y - uy * 21);
      U.ctx.stroke();
    }
    U.txt('🤺', 210, 674, 26);
  }
  const pulse = 1.8 + Math.sin(t / 220) * 1.3;
  for (const n of nodes) {
    const rad = n.type === 'BOSS' ? 26 : 20;
    const isReach = reachIds.includes(n.i);
    const isCur = n.i === G.cur;
    if (n.done && !isCur) U.ctx.globalAlpha = 0.4;
    U.ctx.beginPath();
    U.ctx.arc(n.x, n.y, rad, 0, Math.PI * 2);
    U.ctx.fillStyle = '#1d1d2c';
    U.ctx.fill();
    U.ctx.lineWidth = isReach ? pulse : 2;
    U.ctx.strokeStyle = isCur ? '#ffffff' : isReach ? GOLD : '#3a3a4f';
    U.ctx.stroke();
    U.txt(NODE_EMOJI[n.type], n.x, n.y + 2, n.type === 'BOSS' ? 25 : 18);
    U.ctx.globalAlpha = 1;
    if (isCur) U.txt('🤺', n.x, n.y - rad - 12, 18);
    if (isReach) U.hit(n.x - 29, n.y - 29, 58, 58, () => enterNode(n.i));
  }
  const w = getPrimary(), s = getSecondary(), a = getArmor();
  U.button(14, 716, 122, 60, '🎒', () => { invPage = 0; G.ret = 'MAP'; goto('INV'); }, { size: 22, sub: `${w.emoji}${s.emoji}${a.emoji} Gear` });
  U.button(146, 716, 128, 60, '✨', () => { skillPage = 0; G.ret = 'MAP'; goto('SKILLS'); }, { size: 22, sub: 'Skills' });
  U.button(284, 716, 122, 60, '🔨', () => { craftPage = 0; goto('CRAFT'); }, { size: 22, sub: `Craft ${G.player.scrap}🔩` });
}

// ---------- tactical combat ----------
function shortSkillStat(sk, w) {
  if (sk.fx === 'wx2') return `${w.dmg * 2} dmg`;
  if (sk.fx === 'dmg') return `${sk.v} dmg${sk.pierce ? ' pierce' : ''}`;
  if (sk.fx === 'venom') return `${sk.v} dmg + poison`;
  if (sk.fx === 'whirl') return `${w.dmg} dmg all adjacent`;
  if (sk.fx === 'nova') return `${sk.v} dmg + freeze`;
  if (sk.fx === 'shove') return `${sk.v} dmg + push 2`;
  if (sk.fx === 'heal') return `heal ${sk.v}`;
  if (sk.fx === 'block') return `+${sk.v} block`;
  return 'teleport';
}

function combat(t) {
  const c = G.combat;
  if (!c) { goto('MAP'); return; }
  const P = G.player, w = getPrimary();
  const prep = c.phase === 'prep';
  const myTurn = c.phase === 'player';

  // compact top bar
  U.bar(10, 5, 148, 15, P.hp / P.maxHp, '#4f9d57', `${P.hp}/${P.maxHp}`);
  U.bar(10, 23, 106, 11, P.mp / P.maxMp, '#6a5bbf', `${P.mp} MP`);
  if (c.pBlock > 0) U.txt(`🛡️${c.pBlock}`, 168, 13, 13, BLU, 'left');
  if (c.pPsnT > 0) U.txt(`☠️${c.pPsn}×${c.pPsnT}`, 168, 30, 12, '#a8e06a', 'left');
  U.txt(prep ? '🔭 SCOUT' : c.kind === 'boss' ? '🐉 BOSS' : c.kind === 'ambush' ? '☠️ AMBUSH' : `Turn ${c.turn}`, 412, 12, 13, prep ? BLU : c.kind === 'fight' ? DIM : GOLD, 'right', prep || c.kind !== 'fight');
  U.txt(`💰${P.gold}`, 412, 30, 13, GOLD, 'right');

  // camera: follow the player / acting foe / inspected foe, unless dragged away
  if (G.combat !== lastC) { lastC = G.combat; camFree = false; camFocusKey = ''; }
  const actingFoe = c.phase === 'enemy' && c.foes[c.ei] && !c.foes[c.ei].dead && c.foes[c.ei].awake ? c.foes[c.ei] : null;
  const selFoe = ((myTurn || prep) && c.sel >= 0 && c.foes[c.sel] && !c.foes[c.sel].dead) ? c.foes[c.sel] : null;
  const focus = actingFoe || selFoe || { x: c.px, y: c.py };
  const fkey = `${focus.x},${focus.y}:${c.phase}`;
  if (fkey !== camFocusKey) { camFocusKey = fkey; camFree = false; }
  const maxCX = Math.max(0, c.w * T - VW), maxCY = Math.max(0, c.h * T - VH);
  if (!camFree) {
    const wantX = Math.max(0, Math.min(maxCX, focus.x * T + T / 2 - VW / 2));
    const wantY = Math.max(0, Math.min(maxCY, focus.y * T + T / 2 - VH / 2));
    camX += (wantX - camX) * 0.22;
    camY += (wantY - camY) * 0.22;
    if (Math.abs(wantX - camX) < 1) camX = wantX;
    if (Math.abs(wantY - camY) < 1) camY = wantY;
  }
  camX = Math.max(0, Math.min(maxCX, camX));
  camY = Math.max(0, Math.min(maxCY, camY));
  U.dragZone(VX, VY, VW, VH, (dx, dy) => {
    camX = Math.max(0, Math.min(maxCX, camX - dx));
    camY = Math.max(0, Math.min(maxCY, camY - dy));
    camFree = true;
  });

  // targeting context for the current mode
  const reachMap = (myTurn && c.mode === 'move') ? reach(c, c.px, c.py, c.ap) : null;
  const aTargets = (myTurn && c.mode === 'atk') ? atkTargets() : [];
  const sTargetsStruct = (myTurn && c.mode === 'atk') ? structTargets() : [];
  const slot = c.mode === 'sk0' ? 0 : c.mode === 'sk1' ? 1 : -1;
  const sTargets = (myTurn && slot >= 0) ? skillTargets(slot) : [];
  const sSkill = slot >= 0 ? skillFor(slot) : null;
  const bTargets = (myTurn && c.mode === 'bomb') ? bombTargets() : [];
  const rangeTint =
    c.mode === 'atk' ? { rng: w.rng, color: 'rgba(255,107,94,0.22)' } :
    sSkill && sSkill.tgt === 'foe' ? { rng: sSkill.rng, color: 'rgba(179,157,255,0.22)' } :
    c.mode === 'bomb' && c.potIdx >= 0 ? { rng: 3, color: 'rgba(255,171,74,0.22)' } : null;

  // foe walk-range preview: the inspected foe, or whoever is taking its turn
  let fvFoe = null, fvReach = null, fvThreat = false;
  const fvIdx = actingFoe ? c.ei : selFoe ? c.sel : -1;
  if (fvIdx >= 0) {
    fvFoe = c.foes[fvIdx];
    const budget = actingFoe && c.eap >= 0 ? c.eap : MONSTERS[fvFoe.mid].ap;
    fvReach = foeReach(fvIdx, budget);
    fvThreat = foeThreatens(fvIdx, budget, fvReach);
  }

  // board
  U.ctx.save();
  U.rr(VX, VY, VW, VH, 10);
  U.ctx.clip();
  U.ctx.fillStyle = '#07070c';
  U.ctx.fillRect(VX, VY, VW, VH);
  const wallSet = new Set(c.walls.map(q => q.y * c.w + q.x));
  const isWall = (x, y) => x < 0 || x >= c.w || y < 0 || y >= c.h || wallSet.has(y * c.w + x);
  const x0 = Math.max(0, Math.floor(camX / T)), x1 = Math.min(c.w - 1, Math.ceil((camX + VW) / T));
  const y0 = Math.max(0, Math.floor(camY / T)), y1 = Math.min(c.h - 1, Math.ceil((camY + VH) / T));
  const structRing = (sx, sy) => {
    U.rr(sx + 5, sy + 5, T - 10, T - 10, 8);
    U.ctx.strokeStyle = 'rgba(255,107,94,0.7)';
    U.ctx.lineWidth = 1.5;
    U.ctx.stroke();
  };
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const sx = VX + x * T - camX, sy = VY + y * T - camY;
      const wl = wallSet.has(y * c.w + x) ? c.walls.find(q => q.x === x && q.y === y) : null;
      if (wl) {
        // solid rock: draw a face only where it borders walkable space
        let edge = false;
        for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!isWall(x + dx, y + dy)) { edge = true; break; }
        }
        if (edge) {
          U.ctx.fillStyle = '#1b1b28';
          U.ctx.fillRect(sx, sy, T, T);
          U.ctx.strokeStyle = '#26263a';
          U.ctx.lineWidth = 1;
          U.ctx.strokeRect(sx + 1.5, sy + 1.5, T - 3, T - 3);
          if (wl.hp < wl.mhp) U.bar(sx + 8, sy + T - 9, T - 16, 4, wl.hp / wl.mhp, '#8a6f3a');
          if (sTargetsStruct.some(q => q.x === x && q.y === y)) structRing(sx, sy);
        }
        U.hit(sx, sy, T, T, () => tapBoard(x, y));
        continue;
      }
      U.ctx.fillStyle = (x + y) % 2 ? '#15151f' : '#181822';
      U.ctx.fillRect(sx, sy, T, T);
      if (rangeTint && cheb(c.px, c.py, x, y) <= rangeTint.rng && !(x === c.px && y === c.py)) {
        U.ctx.fillStyle = rangeTint.color;
        U.ctx.fillRect(sx, sy, T, T);
      }
      if (fvReach && fvReach.has(k(x, y))) {
        U.ctx.fillStyle = 'rgba(255,140,60,0.2)';
        U.ctx.fillRect(sx + 2, sy + 2, T - 4, T - 4);
      }
      if (reachMap && reachMap.has(k(x, y))) {
        U.ctx.fillStyle = 'rgba(90,200,110,0.17)';
        U.ctx.fillRect(sx + 2, sy + 2, T - 4, T - 4);
        U.ctx.strokeStyle = 'rgba(127,224,138,0.55)';
        U.ctx.lineWidth = 1.5;
        U.ctx.strokeRect(sx + 3, sy + 3, T - 6, T - 6);
      }
      if (sSkill && sSkill.tgt === 'tile' && sTargets.some(q => q.x === x && q.y === y)) {
        U.ctx.fillStyle = 'rgba(179,157,255,0.22)';
        U.ctx.fillRect(sx + 2, sy + 2, T - 4, T - 4);
      }
      U.hit(sx, sy, T, T, () => tapBoard(x, y));
    }
  }
  // obstacles / traps / chests / ground items
  const seen = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const sPos = (x, y) => [VX + x * T - camX + T / 2, VY + y * T - camY + T / 2];
  for (const o of c.obs) {
    if (!seen(o.x, o.y)) continue;
    const [sx, sy] = sPos(o.x, o.y);
    U.txt(o.e, sx, sy, 30);
    if (o.hp < o.mhp) U.bar(sx - T / 2 + 8, sy + T / 2 - 9, T - 16, 4, o.hp / o.mhp, '#8a6f3a');
    if (sTargetsStruct.some(q => q.x === o.x && q.y === o.y)) structRing(sx - T / 2, sy - T / 2);
  }
  for (const tr of c.traps) {
    if (!seen(tr.x, tr.y)) continue;
    const [sx, sy] = sPos(tr.x, tr.y);
    U.ctx.globalAlpha = tr.sprung ? 0.18 : 0.9;
    U.txt('🔺', sx, sy + 2, 24);
    U.ctx.globalAlpha = 1;
    if (!tr.sprung && tr.hp < tr.mhp) U.bar(sx - T / 2 + 8, sy + T / 2 - 9, T - 16, 4, tr.hp / tr.mhp, '#8a6f3a');
    if (sTargetsStruct.some(q => q.x === tr.x && q.y === tr.y)) structRing(sx - T / 2, sy - T / 2);
  }
  for (const ch of c.chests) {
    if (!seen(ch.x, ch.y)) continue;
    const [sx, sy] = sPos(ch.x, ch.y);
    U.txt(ch.opened ? '📭' : '📦', sx, sy, 32);
  }
  for (const it of c.items) {
    if (it.taken || !seen(it.x, it.y)) continue;
    const [sx, sy] = sPos(it.x, it.y);
    U.txt(it.t === 'gold' ? '💰' : getItem(it.id).emoji, sx, sy, 24);
  }
  // player (red-highlighted while a previewed foe can reach and hit them)
  {
    const [sx, sy] = sPos(c.px, c.py);
    if (fvThreat) {
      const pulse = 0.55 + Math.sin(t / 160) * 0.25;
      U.ctx.fillStyle = `rgba(255,70,60,${pulse * 0.35})`;
      U.ctx.fillRect(sx - T / 2 + 2, sy - T / 2 + 2, T - 4, T - 4);
      U.rr(sx - T / 2 + 2, sy - T / 2 + 2, T - 4, T - 4, 10);
      U.ctx.strokeStyle = `rgba(255,80,70,${pulse})`;
      U.ctx.lineWidth = 3;
      U.ctx.stroke();
      U.txt('⚠️', sx, sy - T / 2 - 8, 13);
    }
    U.txt('🤺', sx, sy, 40);
    if (c.pBlock > 0) U.txt(`🛡️${c.pBlock}`, sx, sy - T / 2 + 9, 11, BLU);
  }
  // foes
  c.foes.forEach((f, i) => {
    if (f.dead || !seen(f.x, f.y)) return;
    const m = MONSTERS[f.mid];
    const sx = VX + f.x * T - camX, sy = VY + f.y * T - camY;
    const targeted = aTargets.includes(i) || bTargets.includes(i) || (sSkill && sSkill.tgt === 'foe' && sTargets.includes(i));
    if (targeted) {
      U.rr(sx + 3, sy + 3, T - 6, T - 6, 10);
      U.ctx.strokeStyle = aTargets.includes(i) ? RED : bTargets.includes(i) ? '#ffab4a' : PUR;
      U.ctx.lineWidth = 2.5;
      U.ctx.stroke();
    }
    if ((c.phase === 'enemy' && c.ei === i) || c.sel === i) {
      U.rr(sx + 2, sy + 2, T - 4, T - 4, 10);
      U.ctx.strokeStyle = c.sel === i ? GOLD : '#ffffff';
      U.ctx.lineWidth = 2;
      U.ctx.stroke();
    }
    if (!f.awake) U.ctx.globalAlpha = 0.8;
    U.txt(m.emoji, sx + T / 2, sy + T / 2 + 2, 38);
    U.ctx.globalAlpha = 1;
    U.txt('❓', sx + T - 9, sy + 10, 10);
    U.bar(sx + 6, sy + T - 9, T - 12, 5, f.hp / f.maxHp, '#b34a44');
    const chips = [`${f.awake ? '' : '💤'}⚡${m.ap}`];
    if (f.block > 0) chips.push(`🛡️${f.block}`);
    if (f.buff > 0) chips.push('💢');
    if (f.psnT > 0) chips.push('☠️');
    if (f.stun > 0) chips.push('🧊');
    U.txt(chips.join(' '), sx + 4, sy + 9, 11, TXT, 'left');
  });
  U.ctx.restore();
  U.panel(VX, VY, VW, VH, 10, null, '#33334a');

  // info strip: AP + current action stats
  for (let i = 0; i < P.apMax; i++) {
    U.ctx.beginPath();
    U.ctx.arc(20 + i * 20, 525, 7, 0, Math.PI * 2);
    U.ctx.fillStyle = i < c.ap ? GRN : '#22222f';
    U.ctx.fill();
  }
  U.txt('AP', 20 + P.apMax * 20 + 4, 526, 12, DIM, 'left');
  const strip = prep ? (fvFoe ? [`${MONSTERS[fvFoe.mid].name}: orange = its range${fvThreat ? ' — it can reach you!' : ''}`, fvThreat ? RED : '#ffab4a'] : ['Scout: drag around · tap foes for range', BLU]) :
    !myTurn ? (fvThreat ? ['Enemy turn — it can hit you!', RED] : ['Enemy turn…', RED]) :
    c.mode === 'atk' ? [`${w.emoji} ${w.name}: ${w.dmg} dmg · rng ${w.rng} · ${w.ap} AP`, RED] :
    sSkill ? [`${sSkill.emoji} ${sSkill.name}: ${shortSkillStat(sSkill, w)} · rng ${sSkill.rng || 0} · ${sSkill.ap}⚡${sSkill.mp}🔮 · cd ${sSkill.cd}`, PUR] :
    c.mode === 'bomb' ? ['💣 10 dmg · rng 3 · 1 AP — tap a foe', '#ffab4a'] :
    selFoe ? [`${MONSTERS[selFoe.mid].name}: orange = its range${fvThreat ? ' — you are in danger!' : ''}`, fvThreat ? RED : '#ffab4a'] :
    ['Green = tiles you can reach', GRN];
  U.txt(strip[0], 412, 526, 12, strip[1], 'right');

  (c.lines || []).slice(-2).forEach((s, i) => U.txt(s, 12, 543 + i * 16, 11, DIM, 'left'));

  if (prep) {
    // scout phase: look around, inspect, set your build, then begin
    U.button(14, 574, 124, 62, '🎒', () => { invPage = 0; G.ret = 'COMBAT'; goto('INV'); }, { size: 20, sub: 'Swap Gear' });
    U.button(148, 574, 124, 62, '✨', () => { skillPage = 0; G.ret = 'COMBAT'; goto('SKILLS'); }, { size: 20, sub: 'Swap Skills' });
    U.button(282, 574, 124, 62, '⚔️', beginBattle, { size: 20, sub: 'BEGIN', fill: '#3a2f1c', stroke: '#8a6f3a' });
    U.txt('Enemies hold still while you scout the room.', 210, 664, 12, DIM);
    U.txt(`${c.foes.filter(f => !f.dead && !f.awake).length} sleeping · ${c.foes.filter(f => !f.dead && f.awake).length} alert`, 210, 686, 12, '#ffab4a');
  } else {
    // action bar
    const dis = !myTurn;
    const qHit = (x, y2, type) => U.hit(x, y2, 30, 30, () => { aInfo = type; });
    const selStroke = (on) => on ? GOLD : undefined;
    U.button(14, 574, 76, 56, '🚶', () => setMode('move'), { size: 20, sub: 'Move', disabled: dis, stroke: selStroke(c.mode === 'move') });
    U.button(94, 574, 76, 56, w.emoji, () => setMode('atk'), { size: 20, sub: `${w.dmg}dmg·${w.ap}⚡`, disabled: dis || c.ap < w.ap, stroke: selStroke(c.mode === 'atk') });
    U.txt('❓', 158, 582, 10, DIM);
    qHit(140, 570, { t: 'atk' });
    for (const s2 of [0, 1]) {
      const sk = skillFor(s2);
      const x = 174 + s2 * 80;
      if (!sk) {
        U.panel(x, 574, 76, 56, 14, '#12121b', '#22222f');
        U.txt('·', x + 38, 602, 18, '#33333f');
        continue;
      }
      const issue = skillIssue(s2);
      const cd = (c.cds && c.cds[sk.id]) || 0;
      U.button(x, 574, 76, 56, sk.emoji, () => {
        if (skillIssue(s2)) return;
        if (sk.tgt === 'self' || sk.tgt === 'burst') castSkill(s2);
        else setMode('sk' + s2);
      }, {
        size: 20,
        sub: cd > 0 ? `CD ${cd}` : issue || `${sk.ap}⚡${sk.mp}🔮`,
        disabled: dis || !!issue,
        stroke: selStroke(c.mode === 'sk' + s2),
      });
      U.txt('❓', x + 64, 582, 10, DIM);
      qHit(x + 46, 570, { t: 'sk', slot: s2 });
    }
    const defGain = 2 + (getSecondary().block || 0) + getArmor().def;
    U.button(334, 574, 72, 56, '🛡️', defend, { size: 20, sub: c.defended ? 'used' : `+${defGain}·1⚡`, disabled: dis || c.ap < 1 || !!c.defended });
    U.txt('❓', 394, 582, 10, DIM);
    qHit(376, 570, { t: 'def' });

    // potions + end turn
    for (let i = 0; i < 3; i++) {
      const x = 14 + i * 88;
      const id = P.potions[i];
      if (id) {
        const p = POTIONS[id];
        U.button(x, 636, 82, 56, p.emoji, () => usePotion(i), {
          size: 22, sub: p.name.split(' ')[0], disabled: dis || c.ap < 1,
          stroke: (c.mode === 'bomb' && c.potIdx === i) ? GOLD : undefined,
        });
      } else {
        U.panel(x, 636, 82, 56, 14, '#12121b', '#22222f');
        U.txt('·', x + 41, 664, 18, '#33333f');
      }
    }
    U.button(282, 636, 124, 56, 'END', endTurn, { size: 18, sub: 'turn', fill: '#3a2f1c', stroke: '#8a6f3a', disabled: dis });

    const hint = !myTurn ? '' :
      c.mode === 'atk' ? 'Tap foes, walls, rocks, or traps in range to hit them' :
      c.mode === 'sk0' || c.mode === 'sk1' ? 'Tap a target in the tinted range' :
      c.mode === 'bomb' ? 'Tap a foe in range to throw' :
      'Tap green: move · tap foe: its range · again: details';
    U.txt(hint, 210, 712, 12, DIM);
  }

  if (c.info >= 0 && c.foes[c.info]) foeInfo(c.foes[c.info]);
  else if (aInfo) actionInfo(aInfo, c);
}

function describeMove(mv) {
  if (mv.t === 'melee') return `${mv.dmg} dmg · melee · ${mv.ap} AP${mv.psn ? ' · poisons' : ''}`;
  if (mv.t === 'rng') return `${mv.dmg} dmg · range ${mv.rng} · ${mv.ap} AP`;
  if (mv.t === 'guard') return `+${mv.block} block · ${mv.ap} AP`;
  return `+${mv.atk} ATK once · ${mv.ap} AP`;
}

function overlayPanel(h) {
  U.ctx.fillStyle = 'rgba(5,5,10,0.72)';
  U.ctx.fillRect(0, 0, U.W, U.H);
  const y0 = Math.max(60, 400 - h / 2);
  U.panel(30, y0, 360, h, 18, '#1a1a28', '#4a4a68');
  return y0;
}

function foeInfo(f) {
  const m = MONSTERS[f.mid];
  const hasMelee = m.moves.some(mv => mv.t === 'melee');
  const h = 158 + m.moves.length * 26 + (hasMelee ? 24 : 0) + 40;
  const y0 = overlayPanel(h);
  U.txt(m.emoji, 76, y0 + 46, 40);
  U.txt(m.name, 110, y0 + 34, 20, TXT, 'left', true);
  U.txt(`❤️ ${f.hp}/${f.maxHp}   🛡️ DEF ${m.def}   ⚡ ${m.ap} AP`, 110, y0 + 60, 13, DIM, 'left');
  U.txt(f.awake ? '👁️ Alert — will act on its turn' : `💤 Asleep — wakes within ${AGRO} tiles or when hurt`, 110, y0 + 80, 12, f.awake ? '#ff9b6b' : DIM, 'left');
  U.txt('Moves', 52, y0 + 112, 14, GOLD, 'left', true);
  m.moves.forEach((mv, i) => {
    U.txt(`${mv.emoji} ${mv.name}`, 52, y0 + 138 + i * 26, 14, TXT, 'left');
    U.txt(describeMove(mv), 368, y0 + 138 + i * 26, 12, DIM, 'right');
  });
  let yy = y0 + 138 + m.moves.length * 26;
  if (hasMelee) {
    U.txt('⚔️ Strikes anyone who steps out of its reach', 52, yy, 12, '#ff9b6b', 'left');
    yy += 24;
  }
  const st = [];
  if (f.buff > 0) st.push(`💢 +${f.buff} ATK`);
  if (f.psnT > 0) st.push(`☠️ poison ${f.psn}×${f.psnT}`);
  if (f.stun > 0) st.push('🧊 frozen');
  if (f.block > 0) st.push(`🛡️ ${f.block} block`);
  if (st.length) U.txt(st.join('   '), 52, yy, 12, '#ff9b6b', 'left');
  U.txt('tap anywhere to close', 210, y0 + h - 18, 11, DIM);
  U.hit(0, 0, U.W, U.H, closeInfo);
}

function actionInfo(info, c) {
  const w = getPrimary();
  let title = '', emoji = '', lines = [];
  if (info.t === 'atk') {
    title = w.name;
    emoji = w.emoji;
    lines = [
      `Damage: ${w.dmg} (±1), before enemy DEF/block`,
      `Range: ${w.rng} — diagonals count`,
      `Cost: ${w.ap} AP per swing`,
      'Leaving an enemy’s reach provokes a free',
      'hit — and fleeing enemies eat yours.',
    ];
  } else if (info.t === 'def') {
    const off = getSecondary(), arm = getArmor();
    title = 'Defend';
    emoji = '🛡️';
    lines = [
      `Gain ${2 + (off.block || 0) + arm.def} block = 2 + ${off.name} ${off.block || 0} + armor ${arm.def}`,
      'Costs 1 AP · once per turn',
      'Block soaks damage until your next turn.',
    ];
  } else {
    const sk = skillFor(info.slot);
    if (!sk) { aInfo = null; return; }
    title = sk.name;
    emoji = sk.emoji;
    lines = [
      sk.desc,
      `Effect: ${shortSkillStat(sk, w)}`,
      `Range: ${sk.rng || '—'}${sk.rng ? ' (diagonals count)' : ''}`,
      `Cost: ${sk.ap} AP + ${sk.mp} MP`,
      `Cooldown: ${sk.cd} turn${sk.cd > 1 ? 's' : ''} after casting`,
    ];
    const cd = (c.cds && c.cds[sk.id]) || 0;
    if (cd > 0) lines.push(`⏳ Ready again in ${cd} turn${cd > 1 ? 's' : ''}`);
  }
  const h = 92 + lines.length * 24 + 34;
  const y0 = overlayPanel(h);
  U.txt(emoji, 72, y0 + 46, 36);
  U.txt(title, 104, y0 + 46, 20, TXT, 'left', true);
  lines.forEach((s, i) => U.txt(s, 52, y0 + 92 + i * 24, 13, i === 0 && info.t === 'sk' ? TXT : DIM, 'left'));
  U.txt('tap anywhere to close', 210, y0 + h - 16, 11, DIM);
  U.hit(0, 0, U.W, U.H, () => { aInfo = null; });
}

// ---------- choice (loot / events / rewards) ----------
function choice() {
  const p = G.pending;
  if (!p) { goto('MAP'); return; }
  header(false);
  U.txt(p.title, 210, 106, 25, TXT, 'center', true);
  if (p.sub) U.txt(p.sub, 210, 140, 15, DIM);
  let y = 168;
  (p.notes || []).slice(0, 4).forEach((s) => {
    U.txt(s, 210, y, 13, GOLD);
    y += 20;
  });
  y += 8;
  p.options.forEach((o, i) => {
    const why = optionDisabled(o);
    if (why) U.ctx.globalAlpha = 0.45;
    U.panel(24, y, 372, 94, 16, '#1c1c2b', '#34344e');
    U.txt(o.emoji, 64, y + 47, 34);
    U.txt(o.label, 102, y + 32, 18, TXT, 'left', true);
    U.txt(o.desc, 102, y + 62, 12, DIM, 'left');
    if (o.act.t === 'buy') U.txt(`💰${o.act.price}`, 388, y + 30, 15, G.player.gold >= o.act.price ? GOLD : '#d9534f', 'right', true);
    if (o.act.t === 'scrapbuy') U.txt(`🔩${o.act.scrap}`, 388, y + 30, 15, G.player.scrap >= o.act.scrap ? TXT : '#d9534f', 'right', true);
    U.ctx.globalAlpha = 1;
    if (why && why !== 'Not enough gold' && why !== 'Not enough scrap') U.txt(why, 388, y + 62, 11, '#d9534f', 'right');
    if (!why) U.hit(24, y, 372, 94, () => pickOption(i));
    y += 106;
  });
  if (p.canSkip) U.button(110, 690, 200, 58, p.canSkip, skipOption, { size: 17 });
}

// ---------- shop ----------
function shop() {
  const sh = G.shop;
  if (!sh) { goto('MAP'); return; }
  header(false);
  U.txt(sh.title, 210, 66, 22, TXT, 'center', true);
  const tab = (x, label, id2) => U.button(x, 88, 190, 50, label, () => { sh.tab = id2; sellPage = 0; }, {
    size: 16, fill: sh.tab === id2 ? '#2c2c44' : '#191926', stroke: sh.tab === id2 ? GOLD : '#2c2c40',
  });
  tab(16, '🛒 Buy', 'buy');
  tab(214, `💰 Sell (${G.player.bag.length})`, 'sell');

  if (sh.tab === 'buy') {
    sh.stock.forEach((s, i) => {
      const y = 156 + i * 98;
      const why = shopBuyIssue(i);
      if (why) U.ctx.globalAlpha = 0.45;
      U.panel(16, y, 388, 90, 16, '#1c1c2b', '#34344e');
      U.txt(s.emoji, 54, y + 45, 32);
      U.txt(s.name, 92, y + 30, 17, TXT, 'left', true);
      U.txt(s.desc, 92, y + 60, 12, DIM, 'left');
      U.txt(s.sold ? 'SOLD' : `💰${s.price}`, 392, y + 30, 15, s.sold ? DIM : G.player.gold >= s.price ? GOLD : '#d9534f', 'right', true);
      U.ctx.globalAlpha = 1;
      if (why && why !== 'SOLD' && why !== 'Not enough gold') U.txt(why, 392, y + 60, 11, '#d9534f', 'right');
      if (!why) U.hit(16, y, 388, 90, () => shopBuy(i));
    });
    U.txt('“Spend it now — gold buys nothing in the grave.”', 210, 570, 12, DIM);
  } else {
    const bag = G.player.bag;
    if (!bag.length) U.txt('Nothing to sell — foes drop gear.', 210, 300, 14, DIM);
    const pages = Math.max(1, Math.ceil(bag.length / 4));
    sellPage = Math.min(sellPage, pages - 1);
    bag.slice(sellPage * 4, sellPage * 4 + 4).forEach((id, j) => {
      const i = sellPage * 4 + j;
      const g = getItem(id);
      const y = 156 + j * 98;
      U.panel(16, y, 388, 90, 16, '#1c1c2b', '#34344e');
      U.txt(g.emoji, 54, y + 45, 32);
      U.txt(g.name, 92, y + 30, 17, TXT, 'left', true);
      U.txt(`T${g.tier} · ${gearDesc(g)}`, 92, y + 60, 12, DIM, 'left');
      U.txt(`+${sellPrice(g)}💰`, 392, y + 45, 15, GOLD, 'right', true);
      U.hit(16, y, 388, 90, () => shopSell(i));
    });
    sellPage = pager(sellPage, pages, (v) => { sellPage = v; });
  }
  U.button(110, 716, 200, 60, '🚪 Leave', shopLeave, { size: 18 });
}

// ---------- gear / bag ----------
function inv() {
  header(false);
  U.txt('🎒 Gear', 210, 64, 22, TXT, 'center', true);
  const rows = [
    ['Weapon', getPrimary()],
    ['Shield', getSecondary()],
    ['Armor', getArmor()],
  ];
  U.panel(16, 84, 388, 108, 16, '#191926', '#2c2c40');
  rows.forEach(([label, g], i) => {
    const y = 104 + i * 34;
    U.txt(label, 30, y, 12, DIM, 'left');
    U.txt(`${g.emoji} ${g.name}`, 96, y, 14, TXT, 'left');
    U.txt(g.cat ? gearDesc(g) : (g.block !== undefined ? `+${g.block} block` : g.def !== undefined ? `${g.def} DEF` : ''), 392, y, 11, DIM, 'right');
  });
  const bag = G.player.bag;
  U.txt(`Bag ${bag.length}/${BAG_MAX} — equip or break into scrap`, 210, 212, 12, DIM);
  if (!bag.length) U.txt('Bag is empty. Every slain foe drops gear.', 210, 330, 13, DIM);
  const pages = Math.max(1, Math.ceil(bag.length / 4));
  invPage = Math.min(invPage, pages - 1);
  bag.slice(invPage * 4, invPage * 4 + 4).forEach((id, j) => {
    const i = invPage * 4 + j;
    const g = getItem(id);
    const y = 232 + j * 98;
    U.panel(16, y, 388, 90, 16, '#1c1c2b', '#34344e');
    U.txt(g.emoji, 48, y + 45, 30);
    U.txt(g.name, 84, y + 28, 16, TXT, 'left', true);
    U.txt(`T${g.tier} · ${gearDesc(g)}`, 84, y + 56, 11, DIM, 'left');
    U.button(252, y + 17, 74, 56, 'Equip', () => equipFromBag(i), { size: 14, fill: '#24405c', stroke: '#5b8ab8' });
    U.button(332, y + 17, 64, 56, `🔩+${scrapValue(g)}`, () => scrapFromBag(i), { size: 13 });
  });
  invPage = pager(invPage, pages, (v) => { invPage = v; });
  backBtn();
}

// ---------- skills / loadout ----------
function skills() {
  header(false);
  U.txt('✨ Skills', 210, 64, 22, TXT, 'center', true);
  U.txt('Equip 2 for battle — tap a slot to clear it', 210, 92, 12, DIM);
  for (const s of [0, 1]) {
    const id = G.player.eq[s];
    const sk = id ? SKILLS[id] : null;
    U.button(16 + s * 198, 108, 190, 62, sk ? `${sk.emoji} ${sk.name}` : '· empty ·',
      () => { if (id) toggleSkill(id); }, {
        size: 15, fill: sk ? '#2c2c44' : '#14141d', stroke: sk ? GOLD : '#2c2c40', sub: sk ? `${sk.ap}⚡ ${sk.mp}🔮 cd${sk.cd}` : `slot ${s + 1}`,
      });
  }
  const known = G.player.known;
  const pages = Math.max(1, Math.ceil(known.length / 4));
  skillPage = Math.min(skillPage, pages - 1);
  known.slice(skillPage * 4, skillPage * 4 + 4).forEach((id, j) => {
    const sk = SKILLS[id];
    const y = 192 + j * 108;
    const equipped = G.player.eq.includes(id);
    U.panel(16, y, 388, 100, 16, equipped ? '#232338' : '#1c1c2b', equipped ? GOLD : '#34344e');
    U.txt(sk.emoji, 48, y + 50, 30);
    U.txt(sk.name, 84, y + 28, 16, TXT, 'left', true);
    U.txt(sk.desc, 84, y + 54, 11, DIM, 'left');
    U.txt(`${sk.ap} AP · ${sk.mp} MP · cd ${sk.cd}`, 84, y + 78, 11, PUR, 'left');
    U.button(308, y + 22, 88, 56, equipped ? 'Unequip' : 'Equip', () => toggleSkill(id), {
      size: 13, fill: equipped ? '#232338' : '#24405c', stroke: equipped ? '#5a5a7a' : '#5b8ab8',
    });
  });
  U.txt(`${known.length}/10 skills known — win fights, visit shrines, craft scrolls`, 210, 630, 11, DIM);
  skillPage = pager(skillPage, pages, (v) => { skillPage = v; });
  backBtn();
}

// ---------- crafting ----------
function craft() {
  header(false);
  U.txt('🔨 Crafting', 210, 64, 22, TXT, 'center', true);
  U.txt(`You have 🔩 ${G.player.scrap} scrap — break down gear to get more`, 210, 92, 12, DIM);
  const pages = Math.max(1, Math.ceil(RECIPES.length / 4));
  craftPage = Math.min(craftPage, pages - 1);
  RECIPES.slice(craftPage * 4, craftPage * 4 + 4).forEach((rec, j) => {
    const i = craftPage * 4 + j;
    const out = getItem(rec.out);
    const y = 116 + j * 108;
    const why = craftIssue(rec);
    if (why) U.ctx.globalAlpha = 0.55;
    U.panel(16, y, 388, 100, 16, '#1c1c2b', '#34344e');
    U.txt(out.emoji, 48, y + 50, 30);
    U.txt(out.name, 84, y + 28, 16, TXT, 'left', true);
    U.txt(out.cat === 'k' ? out.desc : out.cat === 'p' ? out.desc : `T${out.tier} · ${gearDesc(out)}`, 84, y + 56, 11, DIM, 'left');
    U.txt(out.cat === 'k' ? 'skill scroll' : out.cat === 'p' ? 'potion' : 'gear', 84, y + 78, 10, '#55536a', 'left');
    U.txt(`🔩${rec.scrap}`, 322, y + 30, 14, G.player.scrap >= rec.scrap ? TXT : '#d9534f', 'right', true);
    U.ctx.globalAlpha = 1;
    if (why) U.txt(why, 322, y + 50, 10, '#d9534f', 'right');
    U.button(332, y + 44, 64, 48, 'Craft', () => craftItem(i), { size: 13, disabled: !!why, fill: '#3a2f1c', stroke: '#8a6f3a' });
  });
  craftPage = pager(craftPage, pages, (v) => { craftPage = v; });
  backBtn();
}

// ---------- title / end ----------
function title() {
  U.txt('⚔️', 210, 215, 80);
  U.txt('DEPTHS', 210, 305, 52, GOLD, 'center', true);
  U.txt('a pocket tactics roguelike', 210, 347, 15, DIM);
  if (canContinue()) {
    U.button(110, 420, 200, 60, 'Continue', continueRun, { size: 20, fill: '#2a3a2a', stroke: '#4f7a4f' });
  }
  U.button(110, canContinue() ? 498 : 442, 200, 60, 'New Run', () => newRun(), { size: 20 });
  U.txt('⚔️ fight   ❓ event   💰 treasure   🛒 shop', 210, 612, 13, DIM);
  U.txt('Explore scrolling dungeons: move, strike, and cast.', 210, 636, 13, DIM);
  U.txt('Loot every foe. Craft. Slay the dragon on floor 10.', 210, 658, 13, DIM);
  U.txt('v0.4 · built with Claude', 210, 774, 11, '#55536a');
}

function endScreen(emoji, label, color) {
  U.txt(emoji, 210, 230, 88);
  U.txt(label, 210, 330, 36, color, 'center', true);
  const s = G.stats || { floor: 0, kills: 0, goldEarned: 0 };
  U.txt(`Reached floor ${s.floor}/10`, 210, 396, 16, TXT);
  U.txt(`Foes slain: ${s.kills}`, 210, 424, 16, TXT);
  U.txt(`Gold earned: ${s.goldEarned}`, 210, 452, 16, TXT);
  U.txt(`Skills known: ${G.player ? G.player.known.length : 0}/10`, 210, 480, 16, TXT);
  U.button(110, 560, 200, 60, 'New Run', () => newRun(), { size: 20 });
}
