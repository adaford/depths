// All screen rendering. Immediate-mode: each frame redraws and re-registers tap targets.
// Combat draws a square grid through a scrollable camera; taps on the board are
// converted pixel→tile here and routed to combat.tapBoard. Tapping any foe or map
// object selects it: its ranges tint the board AND an inspect panel slides over the
// bottom of the viewport with stats, description, and contextual actions
// (Open / Smash / Dig / Go grab). Long strings self-fit via U.txt maxW / U.wrap.
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
  FX, EXPLORE_STEPS, WALL_HP, tapBoard, setMode, defend, endTurn, usePotion,
  atkTargets, skillTargets, skillFor, skillIssue, bombTargets, castSkill,
  beginBattle, structTargets, structAt, attackStructAt, openChestAt, moveTo,
  foeReach, foeThreatens, foeSightField, isEngaged, nearestFoe, isBehind, clearInspect,
} from './combat.js';
import { MONSTERS, POTIONS, SKILLS, RECIPES, NODE_EMOJI, OBSTACLES, getItem } from './data.js';
import { reach, k, dist, idx, toPixel, fromPixel, boardPx, obsAt, chestAt, trapAt } from './grid.js';

const GOLD = '#e8b45a', DIM = '#a29fb2', TXT = '#ece8de', RED = '#ff6b5e', BLU = '#7fc7ff', PUR = '#b39dff', GRN = '#7fe08a';

// combat board viewport + camera (module-local render state, never saved)
const S = 46; // base tile size at zoom 1
const VX = 4, VY = 44, VW = 412, VH = 474;
let zoom = 1; // pinch/wheel zoom, 0.5–1.6
const se = () => Math.max(22, Math.min(72, S * zoom));
let camX = 0, camY = 0, camFree = false, camFocusKey = '', lastC = null;
let fsCache = null, fsKey = -1; // Set of floor indexes, rebuilt when digging changes it
let sightCache = { key: '', set: null }; // selected foe's visible tiles
let aInfo = null; // action detail overlay: {t:'atk'} | {t:'sk',slot} | {t:'def'}

let invPage = 0, skillPage = 0, craftPage = 0, sellPage = 0;

// convert combat events (tile coords) into floating numbers at screen positions
const FXC = { dmg: '#ffd76a', hurt: '#ff7b6b', blk: BLU, heal: GRN, psn: '#a8e06a', gold: GOLD, mp: PUR, buff: '#ff9b6b' };
function drainFX() {
  for (const ev of FX.splice(0)) {
    const [px, py] = toPixel(ev.tx, ev.ty, se());
    U.addFloat(VX + px - camX, VY + py - camY - 12, ev.v, FXC[ev.c] || TXT);
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
  U.txt(`Fl ${G.stats.floor}/10`, 14, 26, 15, DIM, 'left');
  U.txt(`❤️${p.hp}/${p.maxHp}`, 136, 26, 15, TXT);
  U.txt(`🔮${p.mp}`, 222, 26, 15, PUR);
  U.txt(`💰${p.gold}`, 286, 26, 15, GOLD);
  U.txt(`🔩${p.scrap}`, 348, 26, 15, DIM);
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
  U.txt(`${p + 1} / ${pages}`, 210, 668, 16, DIM);
  U.button(272, 640, 64, 56, '▶', () => set(Math.min(pages - 1, p + 1)), { size: 20, disabled: p >= pages - 1 });
  return p;
}

// ---------- map ----------
function map(t) {
  header(true);
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
      U.ctx.moveTo(n.x + ux * 24, n.y + uy * 24);
      U.ctx.lineTo(m.x - ux * 24, m.y - uy * 24);
      U.ctx.stroke();
    }
  }
  if (G.cur < 0) {
    for (const i of reachIds) {
      const m = nodes[i];
      const dx = m.x - 210, dy = m.y - 690;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      U.ctx.strokeStyle = GOLD;
      U.ctx.beginPath();
      U.ctx.moveTo(210 + ux * 24, 690 + uy * 24);
      U.ctx.lineTo(m.x - ux * 24, m.y - uy * 24);
      U.ctx.stroke();
    }
    U.emo('🤺', 210, 690, 28);
  }
  const pulse = 1.8 + Math.sin(t / 220) * 1.3;
  for (const n of nodes) {
    const rad = n.type === 'BOSS' ? 28 : 23;
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
    U.emo(NODE_EMOJI[n.type], n.x, n.y, n.type === 'BOSS' ? 27 : 21);
    U.ctx.globalAlpha = 1;
    if (isCur) U.emo('🤺', n.x, n.y - rad - 14, 20);
    if (isReach) U.hit(n.x - 30, n.y - 30, 60, 60, () => enterNode(n.i));
  }
  if (G.cur >= 0) U.txt('Tap a glowing node to travel', 210, 698, 13, DIM, 'center', false, 404);
  const w = getPrimary(), s = getSecondary(), a = getArmor();
  U.button(14, 716, 122, 60, '🎒', () => { invPage = 0; G.ret = 'MAP'; goto('INV'); }, { size: 22, emo: true, sub: `${w.emoji}${s.emoji}${a.emoji} Gear` });
  U.button(146, 716, 128, 60, '✨', () => { skillPage = 0; G.ret = 'MAP'; goto('SKILLS'); }, { size: 22, emo: true, sub: 'Skills' });
  U.button(284, 716, 122, 60, '🔨', () => { craftPage = 0; goto('CRAFT'); }, { size: 22, emo: true, sub: `Craft ${G.player.scrap}🔩` });
}

// ---------- tactical combat (squares) ----------
function shortSkillStat(sk, w) {
  if (sk.fx === 'wx2') return `${w.dmg * 2} dmg, crits`;
  if (sk.fx === 'dmg') return `${sk.v} dmg${sk.pierce ? ' pierce' : ''}`;
  if (sk.fx === 'venom') return `${sk.v} dmg + poison`;
  if (sk.fx === 'whirl') return `${w.dmg} dmg all adjacent`;
  if (sk.fx === 'nova') return `${sk.v} dmg + freeze`;
  if (sk.fx === 'shove') return `${sk.v} dmg + push 2`;
  if (sk.fx === 'heal') return `heal ${sk.v}`;
  if (sk.fx === 'block') return `+${sk.v} block`;
  if (sk.fx === 'leap') return `jump + ${w.dmg} dmg`;
  if (sk.fx === 'rtele') return 'random teleport';
  if (sk.fx === 'vanish') return `unseen ${sk.v} turns`;
  if (sk.fx === 'stalk') return 'teleport behind';
  return 'teleport';
}

function cycleFoe() {
  const c = G.combat;
  const alive = c.foes.map((f, i) => ({ f, i })).filter(x => !x.f.dead);
  if (!alive.length) return;
  const cur = alive.findIndex(x => x.i === c.sel);
  c.sel = alive[(cur + 1) % alive.length].i;
  c.insp = null;
}

// Drop the inspection if its target is gone (smashed, opened+looted, picked up, dug out).
function validateInsp(c) {
  const q = c.insp;
  if (!q) return;
  const ok =
    q.t === 'chest' ? !!chestAt(c, q.x, q.y) :
    q.t === 'item' ? c.items.some(i => !i.taken && i.x === q.x && i.y === q.y) :
    (() => { const s = structAt(q.x, q.y); return !!s && s.t === q.t; })();
  if (!ok) c.insp = null;
}

// Inspect panel height (drawn over the bottom of the board viewport).
function panelHeight(c, selFoe) {
  if (selFoe) {
    const m = MONSTERS[selFoe.mid];
    return 96 + m.moves.length * 19 + (m.moves.some(mv => mv.t === 'melee') ? 17 : 0);
  }
  if (!c.insp) return 0;
  if (c.insp.t === 'chest') {
    const ch = chestAt(c, c.insp.x, c.insp.y);
    if (ch && ch.opened) return 92; // no action button on an empty chest
  }
  return 158;
}

function combat(t) {
  const c = G.combat;
  if (!c) { goto('MAP'); return; }
  const P = G.player, w = getPrimary();
  const prep = c.phase === 'prep';
  const myTurn = c.phase === 'player';
  const engaged = isEngaged();
  validateInsp(c);

  // top bar
  U.bar(10, 4, 172, 21, P.hp / P.maxHp, '#4f9d57', `❤️ ${P.hp}/${P.maxHp}`);
  U.bar(10, 28, 128, 14, P.mp / P.maxMp, '#6a5bbf', `${P.mp}/${P.maxMp} MP`);
  if (c.pBlock > 0) U.txt(`🛡️${c.pBlock}`, 192, 15, 15, BLU, 'left');
  if (c.pInvis > 0) U.txt(`🫥${c.pInvis}`, 192, 35, 14, BLU, 'left');
  else if (c.pPsnT > 0) U.txt(`☠️${c.pPsn}×${c.pPsnT}`, 192, 35, 14, '#a8e06a', 'left');
  U.txt(prep ? '🔭 SCOUT' : !engaged ? '🔦 EXPLORE' : c.kind === 'boss' ? '🐉 BOSS' : c.kind === 'ambush' ? '☠️ AMBUSH' : `Turn ${c.turn}`,
    412, 14, 15, prep || !engaged ? BLU : c.kind === 'fight' ? DIM : GOLD, 'right', true);
  U.txt(`💰${P.gold}`, 412, 34, 15, GOLD, 'right');

  // camera: follow the player / acting foe / inspected thing, unless dragged away
  if (G.combat !== lastC) { lastC = G.combat; camFree = false; camFocusKey = ''; fsCache = null; sightCache = { key: '', set: null }; }
  if (!fsCache || fsKey !== c.floors.length) { fsCache = new Set(c.floors); fsKey = c.floors.length; }
  const actingFoe = c.phase === 'enemy' && c.foes[c.ei] && !c.foes[c.ei].dead && c.foes[c.ei].awake ? c.foes[c.ei] : null;
  const selFoe = ((myTurn || prep) && c.sel >= 0 && c.foes[c.sel] && !c.foes[c.sel].dead) ? c.foes[c.sel] : null;
  const pH = panelHeight(c, selFoe); // inspect panel steals this much of the viewport bottom
  const focus = actingFoe || selFoe || (c.insp ? c.insp : { x: c.px, y: c.py });
  const fkey = `${focus.x},${focus.y}:${c.phase}:${pH > 0}`;
  if (fkey !== camFocusKey) { camFocusKey = fkey; camFree = false; }
  const Z = se(), K = Z / S; // effective tile size + visual scale factor
  const [fpx, fpy] = toPixel(focus.x, focus.y, Z);
  const [BW, BH] = boardPx(c, Z);
  const maxCX = Math.max(0, BW - VW), maxCY = Math.max(0, BH - VH);
  if (!camFree) {
    const wantX = Math.max(0, Math.min(maxCX, fpx - VW / 2));
    const wantY = Math.max(0, Math.min(maxCY, fpy - (VH - pH) / 2));
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
  }, (factor, mx, my) => {
    // pinch/wheel zoom around the gesture midpoint
    const old = se();
    zoom = Math.max(0.5, Math.min(1.6, zoom * factor));
    const neu = se();
    if (neu === old) return;
    const wx = (camX + mx - VX) / old, wy = (camY + my - VY) / old;
    camX = wx * neu - (mx - VX);
    camY = wy * neu - (my - VY);
    camFree = true;
  });

  // targeting context for the current mode
  const reachMap = (myTurn && c.mode === 'move') ? reach(c, c.px, c.py, engaged ? c.ap : EXPLORE_STEPS) : null;
  const aTargets = (myTurn && c.mode === 'atk') ? atkTargets() : [];
  const stStruct = (myTurn && c.mode === 'atk') ? structTargets() : [];
  const stSet = new Set(stStruct.map(q => k(q.x, q.y)));
  const slot = c.mode === 'sk0' ? 0 : c.mode === 'sk1' ? 1 : -1;
  const sTargets = (myTurn && slot >= 0) ? skillTargets(slot) : [];
  const sSkill = slot >= 0 ? skillFor(slot) : null;
  const tileSet = sSkill && sSkill.tgt === 'tile' ? new Set(sTargets.map(q => k(q.x, q.y))) : null;
  const bTargets = (myTurn && c.mode === 'bomb') ? bombTargets() : [];
  const rangeTint =
    c.mode === 'atk' ? { rng: w.rng, color: 'rgba(255,107,94,0.2)' } :
    sSkill && sSkill.tgt === 'foe' ? { rng: sSkill.rng, color: 'rgba(179,157,255,0.2)' } :
    c.mode === 'bomb' && c.potIdx >= 0 ? { rng: 3, color: 'rgba(255,171,74,0.2)' } : null;

  // foe walk-range + sight preview: the inspected foe, or whoever is acting
  let fvFoe = null, fvReach = null, fvThreat = false, fvSight = null;
  const fvIdx = actingFoe ? c.ei : selFoe ? c.sel : -1;
  if (fvIdx >= 0) {
    fvFoe = c.foes[fvIdx];
    const budget = actingFoe && c.eap >= 0 ? c.eap : MONSTERS[fvFoe.mid].ap;
    fvReach = foeReach(fvIdx, budget);
    fvThreat = foeThreatens(fvIdx, budget, fvReach);
    if (selFoe) { // sight field only for deliberate inspection (cached)
      const key = `${fvIdx}:${fvFoe.x},${fvFoe.y}:${c.floors.length}:${c.obs.length}`;
      if (sightCache.key !== key) sightCache = { key, set: foeSightField(fvIdx) };
      fvSight = sightCache.set;
    }
  }

  // board
  U.ctx.save();
  U.rr(VX, VY, VW, VH, 10);
  U.ctx.clip();
  U.ctx.fillStyle = '#07070c';
  U.ctx.fillRect(VX, VY, VW, VH);
  const dugSet = new Set(c.dug);
  const scr = (x, y) => { const [px, py] = toPixel(x, y, Z); return [VX + px - camX, VY + py - camY]; };
  const onScreen = (sx, sy) => sx > VX - Z && sx < VX + VW + Z && sy > VY - Z && sy < VY + VH + Z;
  const x0v = Math.max(0, Math.floor(camX / Z)), x1v = Math.min(c.w - 1, Math.ceil((camX + VW) / Z));
  const y0v = Math.max(0, Math.floor(camY / Z)), y1v = Math.min(c.h - 1, Math.ceil((camY + VH) / Z));
  const isFloorAt = (x, y) => x >= 0 && x < c.w && y >= 0 && y < c.h && fsCache.has(y * c.w + x);
  const ring = (sx, sy, color, lw, inset) => {
    U.rr(sx - Z / 2 + inset, sy - Z / 2 + inset, Z - inset * 2, Z - inset * 2, 8 * K);
    U.ctx.strokeStyle = color;
    U.ctx.lineWidth = lw;
    U.ctx.stroke();
  };
  for (let y = y0v; y <= y1v; y++) {
    for (let x = x0v; x <= x1v; x++) {
      const i = y * c.w + x;
      const tlx = VX + x * Z - camX, tly = VY + y * Z - camY;
      if (!fsCache.has(i)) {
        // solid rock: draw a face only where it borders carved floor
        let edge = false;
        for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (isFloorAt(x + dx, y + dy)) { edge = true; break; }
        }
        if (!edge) continue;
        U.ctx.fillStyle = '#262637';
        U.ctx.fillRect(tlx, tly, Z, Z);
        U.ctx.strokeStyle = '#383850';
        U.ctx.lineWidth = 1;
        U.ctx.strokeRect(tlx + 1.5, tly + 1.5, Z - 3, Z - 3);
        const dmgHp = c.wallDmg[i];
        if (dmgHp !== undefined) U.bar(tlx + 8 * K, tly + Z - 10 * K, Z - 16 * K, 5, dmgHp / WALL_HP, '#8a6f3a');
        if (stSet.has(k(x, y))) ring(tlx + Z / 2, tly + Z / 2, 'rgba(255,107,94,0.75)', 2, 4);
        continue;
      }
      U.ctx.fillStyle = dugSet.has(i) ? '#2b241c' : (x + y) % 2 ? '#1b1b28' : '#20202e';
      U.ctx.fillRect(tlx, tly, Z, Z);
      const dd = dist(c.px, c.py, x, y);
      if (fvSight && fvSight.has(k(x, y))) {
        U.ctx.fillStyle = 'rgba(255,215,110,0.15)';
        U.ctx.fillRect(tlx, tly, Z, Z);
      }
      if (rangeTint && dd <= rangeTint.rng && dd > 0) {
        U.ctx.fillStyle = rangeTint.color;
        U.ctx.fillRect(tlx + 1, tly + 1, Z - 2, Z - 2);
      }
      if (fvReach && fvReach.has(k(x, y))) {
        U.ctx.fillStyle = 'rgba(255,140,60,0.22)';
        U.ctx.fillRect(tlx + 1, tly + 1, Z - 2, Z - 2);
      }
      if (reachMap && reachMap.has(k(x, y))) {
        U.ctx.fillStyle = 'rgba(90,200,110,0.18)';
        U.ctx.fillRect(tlx + 2, tly + 2, Z - 4, Z - 4);
        U.ctx.strokeStyle = 'rgba(127,224,138,0.55)';
        U.ctx.lineWidth = 1.5;
        U.ctx.strokeRect(tlx + 3, tly + 3, Z - 6, Z - 6);
      }
      if (tileSet && tileSet.has(k(x, y))) {
        U.ctx.fillStyle = 'rgba(179,157,255,0.25)';
        U.ctx.fillRect(tlx + 2, tly + 2, Z - 4, Z - 4);
      }
    }
  }
  // obstacles / traps / chests / ground items
  for (const o of c.obs) {
    const [sx, sy] = scr(o.x, o.y);
    if (!onScreen(sx, sy)) continue;
    U.emo(o.e, sx, sy, 26 * K);
    if (o.hp < o.mhp) U.bar(sx - 18 * K, sy + 14 * K, 36 * K, 5, o.hp / o.mhp, '#8a6f3a');
    if (stSet.has(k(o.x, o.y))) ring(sx, sy, 'rgba(255,107,94,0.75)', 2, 4);
  }
  for (const tr of c.traps) {
    const [sx, sy] = scr(tr.x, tr.y);
    if (!onScreen(sx, sy)) continue;
    U.ctx.globalAlpha = tr.sprung ? 0.18 : 0.9;
    U.emo('🔺', sx, sy, 20 * K);
    U.ctx.globalAlpha = 1;
    if (!tr.sprung && tr.hp < tr.mhp) U.bar(sx - 18 * K, sy + 14 * K, 36 * K, 5, tr.hp / tr.mhp, '#8a6f3a');
    if (stSet.has(k(tr.x, tr.y))) ring(sx, sy, 'rgba(255,107,94,0.75)', 2, 4);
  }
  for (const ch of c.chests) {
    const [sx, sy] = scr(ch.x, ch.y);
    if (!onScreen(sx, sy)) continue;
    U.emo(ch.opened ? '📭' : '📦', sx, sy, 26 * K);
  }
  for (const it of c.items) {
    if (it.taken) continue;
    const [sx, sy] = scr(it.x, it.y);
    if (!onScreen(sx, sy)) continue;
    U.emo(it.t === 'gold' ? '💰' : getItem(it.id).emoji, sx, sy, 20 * K);
  }
  // inspected object: gold ring on its tile
  if (c.insp) {
    const [sx, sy] = scr(c.insp.x, c.insp.y);
    ring(sx, sy, GOLD, 2, 1);
  }
  // player (red-highlighted while a previewed foe can reach and hit them)
  {
    const [sx, sy] = scr(c.px, c.py);
    if (fvThreat) {
      const pulse = 0.55 + Math.sin(t / 160) * 0.25;
      U.ctx.fillStyle = `rgba(255,70,60,${pulse * 0.35})`;
      U.ctx.fillRect(sx - Z / 2 + 2, sy - Z / 2 + 2, Z - 4, Z - 4);
      ring(sx, sy, `rgba(255,80,70,${pulse})`, 3, 2);
      U.emo('⚠️', sx, sy - Z / 2 - 10, 16);
    }
    if (c.pInvis > 0) U.ctx.globalAlpha = 0.5;
    U.emo('🤺', sx, sy, 34 * K);
    U.ctx.globalAlpha = 1;
    if (c.pBlock > 0) U.txt(`🛡️${c.pBlock}`, sx, sy - Z / 2 + 8, Math.max(10, 13 * K), BLU);
  }
  // foes
  c.foes.forEach((f, i) => {
    if (f.dead) return;
    const [sx, sy] = scr(f.x, f.y);
    if (!onScreen(sx, sy)) return;
    const m = MONSTERS[f.mid];
    const targeted = aTargets.includes(i) || bTargets.includes(i) || (sSkill && sSkill.tgt === 'foe' && sTargets.includes(i));
    const backstab = targeted && aTargets.includes(i) && isBehind(c.px, c.py, f);
    if (targeted) ring(sx, sy, backstab ? GOLD : aTargets.includes(i) ? RED : bTargets.includes(i) ? '#ffab4a' : PUR, 2.5, 3);
    if ((c.phase === 'enemy' && c.ei === i) || c.sel === i) ring(sx, sy, c.sel === i ? GOLD : '#ffffff', 2, 1);
    if (!f.awake) U.ctx.globalAlpha = 0.8;
    U.emo(m.emoji, sx, sy, 30 * K);
    U.ctx.globalAlpha = 1;
    // facing dot: the foe looks this way — strike from the opposite side to crit
    {
      const fx2 = sx + f.face[0] * (Z / 2 - 5 * K), fy2 = sy + f.face[1] * (Z / 2 - 5 * K);
      U.ctx.beginPath();
      U.ctx.arc(fx2, fy2, Math.max(2.5, 3.5 * K), 0, Math.PI * 2);
      U.ctx.fillStyle = backstab ? GOLD : '#e8e4da';
      U.ctx.fill();
    }
    U.bar(sx - 20 * K, sy + 15 * K, 40 * K, 5, f.hp / f.maxHp, '#b34a44');
    const chips = [f.awake ? `⚡${m.ap}` : `💤${f.napT}`];
    if (f.block > 0) chips.push(`🛡️${f.block}`);
    if (f.buff > 0) chips.push('💢');
    if (f.psnT > 0) chips.push('☠️');
    if (f.stun > 0) chips.push('🧊');
    U.txt(chips.join(''), sx, sy - Z / 2 + 7, Math.max(10, 12 * K), TXT);
  });
  // compass to the nearest foe while exploring
  if (!engaged && !prep) {
    const nf = nearestFoe();
    if (nf) {
      const [tpx, tpy] = toPixel(nf.f.x, nf.f.y, Z);
      const sx = VX + tpx - camX, sy = VY + tpy - camY;
      if (!(sx > VX && sx < VX + VW && sy > VY && sy < VY + VH - pH)) {
        const cxp = Math.max(VX + 34, Math.min(VX + VW - 34, sx));
        const cyp = Math.max(VY + 34, Math.min(VY + VH - pH - 34, sy));
        U.ctx.beginPath();
        U.ctx.arc(cxp, cyp, 27, 0, Math.PI * 2);
        U.ctx.fillStyle = 'rgba(20,20,32,0.85)';
        U.ctx.fill();
        U.ctx.strokeStyle = '#ffab4a';
        U.ctx.lineWidth = 2;
        U.ctx.stroke();
        U.emo(MONSTERS[nf.f.mid].emoji, cxp, cyp - 5, 21);
        U.txt(`${nf.d}`, cxp, cyp + 15, 12, '#ffab4a');
        U.hit(cxp - 28, cyp - 28, 56, 56, () => {
          camX = Math.max(0, Math.min(maxCX, tpx - VW / 2));
          camY = Math.max(0, Math.min(maxCY, tpy - VH / 2));
          camFree = true;
        });
      }
    }
  }
  U.ctx.restore();
  U.panel(VX, VY, VW, VH, 10, null, '#33334a');
  // one tap surface for the whole board: convert pixel → tile
  U.hit(VX, VY, VW, VH, (pt) => {
    if (!pt) return;
    const [hx, hy] = fromPixel(pt.x - VX + camX, pt.y - VY + camY, se());
    tapBoard(hx, hy);
  });
  // inspect panel sits over the board bottom and wins taps over it
  if (pH > 0) inspPanel(c, selFoe, myTurn, prep, engaged, fvThreat, pH, w);

  // info strip: AP + current action stats
  for (let i = 0; i < P.apMax; i++) {
    U.ctx.beginPath();
    U.ctx.arc(21 + i * 23, 531, 8.5, 0, Math.PI * 2);
    U.ctx.fillStyle = i < c.ap ? GRN : '#23232f';
    U.ctx.fill();
  }
  U.txt('AP', 21 + P.apMax * 23 + 6, 532, 14, DIM, 'left');
  const stripW = 412 - (21 + P.apMax * 23 + 34);
  const anyBackstab = c.mode === 'atk' && aTargets.some(i => isBehind(c.px, c.py, c.foes[i]));
  const strip = prep ? ['Scout freely — tap things to inspect', BLU] :
    !myTurn ? (fvThreat ? ['Enemy turn — it can hit you!', RED] : ['Enemy turn…', RED]) :
    c.mode === 'atk' ? [anyBackstab ? `${w.emoji} BACKSTAB ready — ×${w.crit || 2}` : `${w.emoji} ${w.dmg} dmg · rng ${w.rng} · ${w.ap}⚡`, anyBackstab ? GOLD : RED] :
    sSkill ? [`${sSkill.emoji} ${shortSkillStat(sSkill, w)} · rng ${sSkill.rng || 0} · ${sSkill.ap}⚡${sSkill.mp}🔮`, PUR] :
    c.mode === 'bomb' ? ['💣 10 dmg · rng 3 — tap a foe', '#ffab4a'] :
    c.pInvis > 0 ? [`🫥 Hidden ${c.pInvis} more turn${c.pInvis > 1 ? 's' : ''}`, BLU] :
    !engaged ? ['🔦 Exploring — moves are free', BLU] :
    ['Green = tiles you can reach', GRN];
  U.txt(strip[0], 412, 532, 14, strip[1], 'right', true, stripW);

  (c.lines || []).slice(-2).forEach((s, i) => U.txt(s, 12, 552 + i * 18, 14, DIM, 'left', false, 396));

  if (prep) {
    // scout phase: look around, inspect, set your build, then begin
    U.button(14, 586, 92, 64, '🎒', () => { invPage = 0; G.ret = 'COMBAT'; goto('INV'); }, { size: 21, emo: true, sub: 'Gear' });
    U.button(112, 586, 92, 64, '✨', () => { skillPage = 0; G.ret = 'COMBAT'; goto('SKILLS'); }, { size: 21, emo: true, sub: 'Skills' });
    U.button(210, 586, 92, 64, '👁', cycleFoe, { size: 21, emo: true, sub: 'Next foe' });
    U.button(308, 586, 98, 64, '⚔️', beginBattle, { size: 21, emo: true, sub: 'BEGIN', fill: '#3a2f1c', stroke: '#8a6f3a' });
    U.txt('Foes hold still while you scout — tap anything to inspect it.', 210, 678, 14, DIM, 'center', false, 404);
    U.txt(`${c.foes.filter(f => !f.dead && !f.awake).length} sleeping · ${c.foes.filter(f => !f.dead && f.awake).length} alert`, 210, 702, 15, '#ffab4a', 'center', true, 404);
  } else {
    // action bar
    const dis = !myTurn;
    const qHit = (x, y2, type) => U.hit(x, y2, 30, 30, () => { aInfo = type; });
    const selStroke = (on) => on ? GOLD : undefined;
    U.button(14, 584, 76, 60, '🚶', () => setMode('move'), { size: 23, emo: true, sub: 'Move', disabled: dis, stroke: selStroke(c.mode === 'move') });
    U.button(94, 584, 76, 60, w.emoji, () => setMode('atk'), { size: 23, emo: true, sub: `${w.dmg}dmg·${w.ap}⚡`, disabled: dis || c.ap < w.ap, stroke: selStroke(c.mode === 'atk') });
    U.txt('❓', 158, 594, 12, DIM);
    qHit(140, 580, { t: 'atk' });
    for (const s2 of [0, 1]) {
      const sk = skillFor(s2);
      const x = 174 + s2 * 80;
      if (!sk) {
        U.panel(x, 584, 76, 60, 14, '#12121b', '#22222f');
        U.txt('·', x + 38, 614, 18, '#33333f');
        continue;
      }
      const issue = skillIssue(s2);
      const cd = (c.cds && c.cds[sk.id]) || 0;
      U.button(x, 584, 76, 60, sk.emoji, () => {
        if (skillIssue(s2)) return;
        if (sk.tgt === 'self' || sk.tgt === 'burst') castSkill(s2);
        else setMode('sk' + s2);
      }, {
        size: 23,
        emo: true,
        sub: cd > 0 ? `CD ${cd}` : issue || `${sk.ap}⚡${sk.mp}🔮`,
        disabled: dis || !!issue,
        stroke: selStroke(c.mode === 'sk' + s2),
      });
      U.txt('❓', x + 64, 594, 12, DIM);
      qHit(x + 46, 580, { t: 'sk', slot: s2 });
    }
    const defGain = 2 + (getSecondary().block || 0) + getArmor().def;
    U.button(334, 584, 72, 60, '🛡️', defend, { size: 23, emo: true, sub: c.defended ? 'used' : `+${defGain}·1⚡`, disabled: dis || c.ap < 1 || !!c.defended });
    U.txt('❓', 394, 594, 12, DIM);
    qHit(376, 580, { t: 'def' });

    // potions + end turn
    for (let i = 0; i < 3; i++) {
      const x = 14 + i * 88;
      const id = P.potions[i];
      if (id) {
        const p = POTIONS[id];
        U.button(x, 650, 82, 60, p.emoji, () => usePotion(i), {
          size: 25, emo: true, sub: p.name.split(' ')[0], disabled: dis || c.ap < 1,
          stroke: (c.mode === 'bomb' && c.potIdx === i) ? GOLD : undefined,
        });
      } else {
        U.panel(x, 650, 82, 60, 14, '#12121b', '#22222f');
        U.txt('·', x + 41, 680, 18, '#33333f');
      }
    }
    U.button(282, 650, 124, 60, 'END', endTurn, { size: 21, sub: engaged ? 'turn' : 'explore', fill: '#3a2f1c', stroke: '#8a6f3a', disabled: dis || !engaged });

    const hint = !myTurn ? '' :
      c.mode === 'atk' ? 'Hit the side away from the dot for crits' :
      c.mode === 'sk0' || c.mode === 'sk1' ? 'Tap a target in the tinted range' :
      c.mode === 'bomb' ? 'Tap a foe in range to throw' :
      !engaged ? 'Stride freely · pinch to zoom · tap things to inspect' :
      'Tap green to move · tap foes or objects to inspect';
    U.txt(hint, 210, 730, 14, DIM, 'center', false, 404);
  }

  if (aInfo) actionInfo(aInfo, c);
}

function describeMove(mv) {
  if (mv.t === 'melee') return `${mv.dmg} dmg · melee · ${mv.ap} AP${mv.psn ? ' · poisons' : ''}`;
  if (mv.t === 'rng') return `${mv.dmg} dmg · range ${mv.rng} · ${mv.ap} AP`;
  if (mv.t === 'guard') return `+${mv.block} block · ${mv.ap} AP`;
  return `+${mv.atk} ATK once · ${mv.ap} AP`;
}

// The tap-to-inspect panel over the board bottom: a selected foe's full readout,
// or an object's description with its contextual action (Open / Smash / Dig / Grab).
function inspPanel(c, selFoe, myTurn, prep, engaged, fvThreat, pH, w) {
  const py = VY + VH - pH;
  U.panel(VX, py, VW, pH, 12, 'rgba(15,15,25,0.95)', '#4a4a68');
  U.hit(VX, py, VW, pH, clearInspect); // tap the panel body to dismiss
  const L = VX + 14, R = VX + VW - 12;

  if (selFoe) {
    const m = MONSTERS[selFoe.mid];
    U.emo(m.emoji, VX + 34, py + 26, 30);
    U.txt(m.name, VX + 62, py + 20, 17, TXT, 'left', true, 166);
    U.txt(`❤️${selFoe.hp}/${selFoe.maxHp}  🛡️${m.def}  ⚡${m.ap}`, R, py + 20, 13, TXT, 'right', false, 150);
    U.txt(m.desc || '', VX + 62, py + 45, 13, DIM, 'left', false, VW - 76);
    const st = [`👁 sight ${m.sight}`, selFoe.awake ? 'alert' : `wakes in ${selFoe.napT}`];
    if (fvThreat) st.push('CAN REACH YOU');
    if (selFoe.block > 0) st.push(`🛡️${selFoe.block}`);
    if (selFoe.buff > 0) st.push(`💢+${selFoe.buff}`);
    if (selFoe.psnT > 0) st.push(`☠️${selFoe.psn}×${selFoe.psnT}`);
    if (selFoe.stun > 0) st.push('🧊 frozen');
    U.txt(st.join(' · '), L, py + 66, 13, fvThreat ? RED : selFoe.awake ? '#ff9b6b' : DIM, 'left', false, VW - 28);
    m.moves.forEach((mv, i) => {
      const yy = py + 88 + i * 19;
      U.txt(`${mv.emoji} ${mv.name}`, L, yy, 13, TXT, 'left', false, 158);
      U.txt(describeMove(mv), R, yy, 12, DIM, 'right', false, 218);
    });
    if (m.moves.some(mv => mv.t === 'melee')) {
      U.txt('⚔️ strikes you if you step out of its reach', L, py + 88 + m.moves.length * 19, 12, '#ff9b6b', 'left', false, VW - 28);
    }
    return;
  }

  const q = c.insp;
  if (!q) return;
  let emoji = '❔', title2 = '', desc = '', hpTxt = '', btn = null;
  const dd = dist(c.px, c.py, q.x, q.y);
  const noAct = prep ? 'after BEGIN' : !myTurn ? 'wait…' : '';
  const atkBtn = (label) => ({
    label,
    sub: noAct || (dd > w.rng ? 'out of range' : c.ap < w.ap ? `need ${w.ap}⚡` : `${w.dmg} dmg · ${w.ap}⚡`),
    dis: !!noAct || dd > w.rng || c.ap < w.ap,
    fn: () => attackStructAt(q.x, q.y),
  });
  if (q.t === 'obs') {
    const o = obsAt(c, q.x, q.y);
    const ot = OBSTACLES.find(z => z.e === o.e) || { name: 'Obstacle', desc: 'Blocks the way.' };
    emoji = o.e;
    title2 = ot.name;
    desc = ot.desc;
    hpTxt = `${o.hp}/${o.mhp}`;
    btn = atkBtn('⚔️ Smash');
  } else if (q.t === 'trap') {
    const tr = trapAt(c, q.x, q.y);
    emoji = '🔺';
    title2 = 'Spike Trap';
    desc = `Deals ${tr.dmg} damage to whoever steps on it — you, or a foe you shove in.`;
    hpTxt = `${tr.hp}/${tr.mhp}`;
    btn = atkBtn('⚒️ Disarm');
  } else if (q.t === 'wall') {
    emoji = '⛏️';
    title2 = 'Rock Wall';
    desc = 'Solid rock. Dig through it with your weapon to open a shortcut.';
    const wi = idx(c, q.x, q.y);
    const hp = c.wallDmg[wi] !== undefined ? c.wallDmg[wi] : WALL_HP;
    hpTxt = `${hp}/${WALL_HP}`;
    btn = atkBtn('⛏️ Dig');
  } else if (q.t === 'chest') {
    const ch = chestAt(c, q.x, q.y);
    if (ch.opened) {
      emoji = '📭';
      title2 = 'Looted Chest';
      desc = 'Nothing left but dust.';
    } else {
      emoji = '📦';
      title2 = 'Locked Chest';
      desc = 'Gold, scrap, a potion, or gear inside. Open it from an adjacent tile.';
      btn = {
        label: '📦 Open',
        sub: noAct || (dd !== 1 ? 'stand next to it' : c.ap < 1 ? 'need 1⚡' : '1⚡'),
        dis: !!noAct || dd !== 1 || c.ap < 1,
        fn: () => openChestAt(q.x, q.y),
      };
    }
  } else if (q.t === 'item') {
    const it = c.items.find(i => !i.taken && i.x === q.x && i.y === q.y);
    if (it.t === 'gold') {
      emoji = '💰';
      title2 = `${it.v} Gold`;
      desc = 'Walk onto it to scoop it up.';
    } else {
      const g = getItem(it.id);
      emoji = g.emoji;
      title2 = g.name;
      desc = `${g.cat === 'p' ? g.desc : `T${g.tier} · ${gearDesc(g)}`} — walk onto it to pick it up.`;
    }
    const cost = reach(c, c.px, c.py, engaged ? c.ap : EXPLORE_STEPS).get(k(q.x, q.y));
    btn = {
      label: '🚶 Go grab',
      sub: noAct || (!cost ? 'not in reach' : engaged ? `${cost}⚡` : 'free'),
      dis: !!noAct || !cost,
      fn: () => moveTo(q.x, q.y),
    };
  }
  U.emo(emoji, VX + 34, py + 26, 28);
  U.txt(title2, VX + 62, py + 20, 17, TXT, 'left', true, 210);
  if (hpTxt) U.txt(`❤️ ${hpTxt}`, R, py + 20, 13, TXT, 'right');
  U.wrap(desc, VX + 62, py + 46, VW - 76, 13, 17, DIM, 'left', 2);
  if (btn) {
    U.txt('tap elsewhere to close', L, py + pH - 34, 11, '#6b687e', 'left', false, 190);
    U.button(VX + VW - 182, py + pH - 64, 170, 56, btn.label, btn.fn, {
      size: 16, sub: btn.sub, disabled: btn.dis, fill: '#2c3c2c', stroke: btn.dis ? undefined : '#5f8a5f',
    });
  }
}

function overlayPanel(h) {
  U.ctx.fillStyle = 'rgba(5,5,10,0.72)';
  U.ctx.fillRect(0, 0, U.W, U.H);
  const y0 = Math.max(60, 400 - h / 2);
  U.panel(30, y0, 360, h, 18, '#1a1a28', '#4a4a68');
  return y0;
}

function actionInfo(info, c) {
  const w = getPrimary();
  let title2 = '', emoji = '', lines = [];
  if (info.t === 'atk') {
    title2 = w.name;
    emoji = w.emoji;
    lines = [
      `Damage: ${w.dmg} (±1), before enemy DEF/block`,
      `Range: ${w.rng} — diagonals count; ranged needs sight`,
      `Cost: ${w.ap} AP per swing`,
      `Backstab: ×${w.crit || 2} from behind the facing dot`,
      'Also smashes rock walls, obstacles, and traps.',
      'Leaving an enemy’s reach provokes a free hit.',
    ];
  } else if (info.t === 'def') {
    const off = getSecondary(), arm = getArmor();
    title2 = 'Defend';
    emoji = '🛡️';
    lines = [
      `Gain ${2 + (off.block || 0) + arm.def} block = 2 + ${off.name} ${off.block || 0} + armor ${arm.def}`,
      'Costs 1 AP · once per turn',
      'Block soaks damage until your next turn.',
    ];
  } else {
    const sk = skillFor(info.slot);
    if (!sk) { aInfo = null; return; }
    title2 = sk.name;
    emoji = sk.emoji;
    lines = [
      sk.desc,
      `Effect: ${shortSkillStat(sk, w)}`,
      `Range: ${sk.rng || '—'}${sk.noLos ? ' (ignores walls)' : sk.rng > 1 ? ' (needs sight)' : ''}`,
      `Cost: ${sk.ap} AP + ${sk.mp} MP`,
      `Cooldown: ${sk.cd} turn${sk.cd > 1 ? 's' : ''} after casting`,
    ];
    const cd = (c.cds && c.cds[sk.id]) || 0;
    if (cd > 0) lines.push(`⏳ Ready again in ${cd} turn${cd > 1 ? 's' : ''}`);
  }
  const h = 92 + lines.length * 24 + 34;
  const y0 = overlayPanel(h);
  U.emo(emoji, 72, y0 + 46, 36);
  U.txt(title2, 104, y0 + 46, 20, TXT, 'left', true, 270);
  lines.forEach((s, i) => U.txt(s, 52, y0 + 92 + i * 24, 14, i === 0 && info.t === 'sk' ? TXT : DIM, 'left', false, 322));
  U.txt('tap anywhere to close', 210, y0 + h - 16, 12, DIM);
  U.hit(0, 0, U.W, U.H, () => { aInfo = null; });
}

// ---------- choice (loot / events / rewards) ----------
function choice() {
  const p = G.pending;
  if (!p) { goto('MAP'); return; }
  header(false);
  U.txt(p.title, 210, 106, 25, TXT, 'center', true, 400);
  if (p.sub) U.txt(p.sub, 210, 140, 16, DIM, 'center', false, 400);
  let y = 168;
  (p.notes || []).slice(0, 4).forEach((s) => {
    U.txt(s, 210, y, 15, GOLD, 'center', false, 396);
    y += 20;
  });
  y += 8;
  p.options.forEach((o, i) => {
    const why = optionDisabled(o);
    if (why) U.ctx.globalAlpha = 0.45;
    U.panel(24, y, 372, 94, 16, '#1c1c2b', '#34344e');
    U.emo(o.emoji, 64, y + 47, 34);
    U.txt(o.label, 102, y + 26, 18, TXT, 'left', true, 220);
    U.wrap(o.desc, 102, y + 52, 262, 13, 17, DIM, 'left', 2);
    if (o.act.t === 'buy') U.txt(`💰${o.act.price}`, 388, y + 26, 16, G.player.gold >= o.act.price ? GOLD : '#d9534f', 'right', true);
    if (o.act.t === 'scrapbuy') U.txt(`🔩${o.act.scrap}`, 388, y + 26, 16, G.player.scrap >= o.act.scrap ? TXT : '#d9534f', 'right', true);
    U.ctx.globalAlpha = 1;
    if (why && why !== 'Not enough gold' && why !== 'Not enough scrap') U.txt(why, 388, y + 80, 12, '#d9534f', 'right', false, 120);
    if (!why) U.hit(24, y, 372, 94, () => pickOption(i));
    y += 106;
  });
  if (p.canSkip) U.button(110, 690, 200, 58, p.canSkip, skipOption, { size: 18 });
}

// ---------- shop ----------
function shop() {
  const sh = G.shop;
  if (!sh) { goto('MAP'); return; }
  header(false);
  U.txt(sh.title, 210, 66, 22, TXT, 'center', true, 400);
  const tab = (x, label, id2) => U.button(x, 88, 190, 50, label, () => { sh.tab = id2; sellPage = 0; }, {
    size: 17, fill: sh.tab === id2 ? '#2c2c44' : '#191926', stroke: sh.tab === id2 ? GOLD : '#2c2c40',
  });
  tab(16, '🛒 Buy', 'buy');
  tab(214, `💰 Sell (${G.player.bag.length})`, 'sell');

  if (sh.tab === 'buy') {
    sh.stock.forEach((s, i) => {
      const y = 156 + i * 98;
      const why = shopBuyIssue(i);
      if (why) U.ctx.globalAlpha = 0.45;
      U.panel(16, y, 388, 90, 16, '#1c1c2b', '#34344e');
      U.emo(s.emoji, 54, y + 45, 32);
      U.txt(s.name, 92, y + 26, 18, TXT, 'left', true, 224);
      U.txt(s.desc, 92, y + 60, 14, DIM, 'left', false, 296);
      U.txt(s.sold ? 'SOLD' : `💰${s.price}`, 392, y + 26, 16, s.sold ? DIM : G.player.gold >= s.price ? GOLD : '#d9534f', 'right', true);
      U.ctx.globalAlpha = 1;
      if (why && why !== 'SOLD' && why !== 'Not enough gold') U.txt(why, 392, y + 46, 12, '#d9534f', 'right', false, 110);
      if (!why) U.hit(16, y, 388, 90, () => shopBuy(i));
    });
    U.txt('“Spend it now — gold buys nothing in the grave.”', 210, 570, 14, DIM, 'center', false, 400);
  } else {
    const bag = G.player.bag;
    if (!bag.length) U.txt('Nothing to sell — foes drop gear.', 210, 300, 15, DIM, 'center', false, 396);
    const pages = Math.max(1, Math.ceil(bag.length / 4));
    sellPage = Math.min(sellPage, pages - 1);
    bag.slice(sellPage * 4, sellPage * 4 + 4).forEach((id, j) => {
      const i = sellPage * 4 + j;
      const g = getItem(id);
      const y = 156 + j * 98;
      U.panel(16, y, 388, 90, 16, '#1c1c2b', '#34344e');
      U.emo(g.emoji, 54, y + 45, 32);
      U.txt(g.name, 92, y + 30, 18, TXT, 'left', true, 224);
      U.txt(`T${g.tier} · ${gearDesc(g)}`, 92, y + 60, 14, DIM, 'left', false, 226);
      U.txt(`+${sellPrice(g)}💰`, 392, y + 45, 16, GOLD, 'right', true);
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
    U.txt(label, 30, y, 13, DIM, 'left');
    U.txt(`${g.emoji} ${g.name}`, 96, y, 15, TXT, 'left', false, 170);
    U.txt(g.cat === 'w' ? gearDesc(g) : (g.block !== undefined ? `+${g.block} block` : g.def !== undefined ? `${g.def} DEF` : ''), 392, y, 13, DIM, 'right', false, 120);
  });
  const bag = G.player.bag;
  U.txt(`Bag ${bag.length}/${BAG_MAX} — equip or break into scrap`, 210, 212, 14, DIM, 'center', false, 396);
  if (!bag.length) U.txt('Bag is empty. Every slain foe drops gear.', 210, 330, 15, DIM, 'center', false, 396);
  const pages = Math.max(1, Math.ceil(bag.length / 4));
  invPage = Math.min(invPage, pages - 1);
  bag.slice(invPage * 4, invPage * 4 + 4).forEach((id, j) => {
    const i = invPage * 4 + j;
    const g = getItem(id);
    const y = 232 + j * 98;
    U.panel(16, y, 388, 90, 16, '#1c1c2b', '#34344e');
    U.emo(g.emoji, 48, y + 45, 30);
    U.txt(g.name, 84, y + 28, 17, TXT, 'left', true, 158);
    U.txt(`T${g.tier} · ${gearDesc(g)}`, 84, y + 56, 13, DIM, 'left', false, 160);
    U.button(252, y + 17, 74, 56, 'Equip', () => equipFromBag(i), { size: 15, fill: '#24405c', stroke: '#5b8ab8' });
    U.button(332, y + 17, 64, 56, `🔩+${scrapValue(g)}`, () => scrapFromBag(i), { size: 14 });
  });
  invPage = pager(invPage, pages, (v) => { invPage = v; });
  backBtn();
}

// ---------- skills / loadout ----------
function skills() {
  header(false);
  U.txt('✨ Skills', 210, 64, 22, TXT, 'center', true);
  U.txt('Equip 2 for battle — tap a slot to clear it', 210, 92, 14, DIM, 'center', false, 396);
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
    U.emo(sk.emoji, 48, y + 50, 30);
    U.txt(sk.name, 84, y + 24, 17, TXT, 'left', true, 212);
    U.wrap(sk.desc, 84, y + 48, 210, 13, 16, DIM, 'left', 2);
    U.txt(`${sk.ap} AP · ${sk.mp} MP · cd ${sk.cd}`, 84, y + 84, 13, PUR, 'left', false, 210);
    U.button(308, y + 22, 88, 56, equipped ? 'Unequip' : 'Equip', () => toggleSkill(id), {
      size: 14, fill: equipped ? '#232338' : '#24405c', stroke: equipped ? '#5a5a7a' : '#5b8ab8',
    });
  });
  U.txt(`${known.length}/${Object.keys(SKILLS).length} skills known — fights, shrines, and scrolls teach more`, 210, 630, 13, DIM, 'center', false, 400);
  skillPage = pager(skillPage, pages, (v) => { skillPage = v; });
  backBtn();
}

// ---------- crafting ----------
function craft() {
  header(false);
  U.txt('🔨 Crafting', 210, 64, 22, TXT, 'center', true);
  U.txt(`You have 🔩 ${G.player.scrap} scrap — break down gear to get more`, 210, 92, 14, DIM, 'center', false, 396);
  const pages = Math.max(1, Math.ceil(RECIPES.length / 4));
  craftPage = Math.min(craftPage, pages - 1);
  RECIPES.slice(craftPage * 4, craftPage * 4 + 4).forEach((rec, j) => {
    const i = craftPage * 4 + j;
    const out = getItem(rec.out);
    const y = 116 + j * 108;
    const why = craftIssue(rec);
    if (why) U.ctx.globalAlpha = 0.55;
    U.panel(16, y, 388, 100, 16, '#1c1c2b', '#34344e');
    U.emo(out.emoji, 48, y + 50, 30);
    U.txt(out.name, 84, y + 24, 17, TXT, 'left', true, 164);
    U.wrap(out.cat === 'k' || out.cat === 'p' ? out.desc : `T${out.tier} · ${gearDesc(out)}`, 84, y + 46, 234, 13, 16, DIM, 'left', 2);
    U.txt(out.cat === 'k' ? 'skill scroll' : out.cat === 'p' ? 'potion' : 'gear', 84, y + 84, 12, '#6b687e', 'left', false, 140);
    U.txt(`🔩${rec.scrap}`, 396, y + 24, 16, G.player.scrap >= rec.scrap ? TXT : '#d9534f', 'right', true);
    U.ctx.globalAlpha = 1;
    if (why) U.txt(why, 322, y + 84, 12, '#d9534f', 'right', false, 92);
    U.button(332, y + 36, 64, 56, 'Craft', () => craftItem(i), { size: 14, disabled: !!why, fill: '#3a2f1c', stroke: '#8a6f3a' });
  });
  craftPage = pager(craftPage, pages, (v) => { craftPage = v; });
  backBtn();
}

// ---------- title / end ----------
function title() {
  U.emo('⚔️', 210, 215, 80);
  U.txt('DEPTHS', 210, 305, 52, GOLD, 'center', true);
  U.txt('a pocket tactics roguelike', 210, 347, 16, DIM);
  if (canContinue()) {
    U.button(110, 420, 200, 60, 'Continue', continueRun, { size: 20, fill: '#2a3a2a', stroke: '#4f7a4f' });
  }
  U.button(110, canContinue() ? 498 : 442, 200, 60, 'New Run', () => newRun(), { size: 20 });
  U.txt('⚔️ fight   ❓ event   💰 treasure   🛒 shop', 210, 612, 15, DIM, 'center', false, 400);
  U.txt('Sneak the dungeons: sight lines, backstabs, traps.', 210, 638, 15, DIM, 'center', false, 400);
  U.txt('Loot every foe. Craft. Slay the dragon on floor 10.', 210, 662, 15, DIM, 'center', false, 400);
  U.txt('v0.8 · built with Claude', 210, 774, 12, '#6b687e');
}

function endScreen(emoji, label, color) {
  U.emo(emoji, 210, 230, 88);
  U.txt(label, 210, 330, 36, color, 'center', true);
  const s = G.stats || { floor: 0, kills: 0, goldEarned: 0 };
  U.txt(`Reached floor ${s.floor}/10`, 210, 396, 18, TXT);
  U.txt(`Foes slain: ${s.kills}`, 210, 427, 18, TXT);
  U.txt(`Gold earned: ${s.goldEarned}`, 210, 458, 18, TXT);
  U.txt(`Skills known: ${G.player ? G.player.known.length : 0}/${Object.keys(SKILLS).length}`, 210, 489, 18, TXT);
  U.button(110, 560, 200, 60, 'New Run', () => newRun(), { size: 20 });
}
