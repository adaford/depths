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
  FX, tapBoard, setMode, defend, endTurn, usePotion, closeInfo,
  atkTargets, skillTargets, skillFor, skillIssue, bombTargets, castSkill,
} from './combat.js';
import { MONSTERS, POTIONS, SKILLS, RECIPES, NODE_EMOJI, getItem } from './data.js';
import { reach, k, CW, CH, wallAt } from './grid.js';

const GOLD = '#e8b45a', DIM = '#8a8798', TXT = '#e8e4da', RED = '#ff6b5e', BLU = '#7fc7ff', PUR = '#b39dff';
const T = 56, BX = 14, BY = 88; // board tile size + origin

let invPage = 0, skillPage = 0, craftPage = 0, sellPage = 0;

// convert combat events (tile coords) into floating numbers at screen positions
const FXC = { dmg: '#ffd76a', hurt: '#ff7b6b', blk: BLU, heal: '#7fe08a', psn: '#a8e06a', gold: GOLD, mp: PUR, buff: '#ff9b6b' };
function drainFX() {
  for (const ev of FX.splice(0)) {
    U.addFloat(BX + ev.tx * T + T / 2, BY + ev.ty * T + 12, ev.v, FXC[ev.c] || TXT);
  }
}

export function render(t, dt) {
  U.frameStart();
  if (G.screen !== 'COMBAT') { FX.length = 0; U.floats.length = 0; }
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
  U.txt(`Fl ${G.stats.floor}/8`, 14, 26, 14, DIM, 'left');
  U.txt(`❤️${p.hp}/${p.maxHp}`, 130, 26, 14, TXT);
  U.txt(`🔮${p.mp}`, 215, 26, 14, PUR);
  U.txt(`💰${p.gold}`, 278, 26, 14, GOLD);
  U.txt(`🔩${p.scrap}`, 340, 26, 14, DIM);
  if (showMenu) U.button(374, 6, 38, 38, '≡', () => { G.back = 'MAP'; goto('TITLE'); }, { size: 20 });
}

function backBtn() {
  U.button(110, 716, 200, 60, '⬅ Back to Map', () => goto('MAP'), { size: 17 });
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
  U.txt('Tap a glowing node to travel', 210, 56, 12, DIM);
  const nodes = G.map.nodes;
  const reachIds = reachable();
  U.ctx.lineWidth = 3;
  for (const n of nodes) {
    for (const j of n.next) {
      const m = nodes[j];
      const dx = m.x - n.x, dy = m.y - n.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      U.ctx.strokeStyle = (n.i === G.cur && reachIds.includes(j)) ? GOLD : '#2b2b40';
      U.ctx.beginPath();
      U.ctx.moveTo(n.x + ux * 26, n.y + uy * 26);
      U.ctx.lineTo(m.x - ux * 26, m.y - uy * 26);
      U.ctx.stroke();
    }
  }
  if (G.cur < 0) {
    for (const i of reachIds) {
      const m = nodes[i];
      const dx = m.x - 210, dy = m.y - 672;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      U.ctx.strokeStyle = GOLD;
      U.ctx.beginPath();
      U.ctx.moveTo(210 + ux * 24, 672 + uy * 24);
      U.ctx.lineTo(m.x - ux * 26, m.y - uy * 26);
      U.ctx.stroke();
    }
    U.txt('🤺', 210, 672, 28);
  }
  const pulse = 2 + Math.sin(t / 220) * 1.5;
  for (const n of nodes) {
    const rad = n.type === 'BOSS' ? 28 : 23;
    const isReach = reachIds.includes(n.i);
    const isCur = n.i === G.cur;
    if (n.done && !isCur) U.ctx.globalAlpha = 0.45;
    U.ctx.beginPath();
    U.ctx.arc(n.x, n.y, rad, 0, Math.PI * 2);
    U.ctx.fillStyle = '#1d1d2c';
    U.ctx.fill();
    U.ctx.lineWidth = isReach ? pulse : 2;
    U.ctx.strokeStyle = isCur ? '#ffffff' : isReach ? GOLD : '#3a3a4f';
    U.ctx.stroke();
    U.txt(NODE_EMOJI[n.type], n.x, n.y + 1, n.type === 'BOSS' ? 28 : 21);
    U.ctx.globalAlpha = 1;
    if (isCur) U.txt('🤺', n.x, n.y - rad - 14, 20);
    if (isReach) U.hit(n.x - 30, n.y - 30, 60, 60, () => enterNode(n.i));
  }
  const w = getPrimary(), s = getSecondary(), a = getArmor();
  U.button(14, 716, 122, 60, '🎒', () => { invPage = 0; goto('INV'); }, { size: 22, sub: `${w.emoji}${s.emoji}${a.emoji} Gear` });
  U.button(146, 716, 128, 60, '✨', () => { skillPage = 0; goto('SKILLS'); }, { size: 22, sub: 'Skills' });
  U.button(284, 716, 122, 60, '🔨', () => { craftPage = 0; goto('CRAFT'); }, { size: 22, sub: `Craft ${G.player.scrap}🔩` });
}

// ---------- tactical combat ----------
const tileXY = (x, y) => [BX + x * T, BY + y * T];

function combat(t) {
  const c = G.combat;
  if (!c) { goto('MAP'); return; }
  const P = G.player, w = getPrimary();
  const myTurn = c.phase === 'player';

  // top bars
  U.bar(14, 10, 160, 17, P.hp / P.maxHp, '#4f9d57', `${P.hp}/${P.maxHp}`);
  U.bar(14, 32, 110, 12, P.mp / P.maxMp, '#6a5bbf', `${P.mp}/${P.maxMp} MP`);
  if (c.pBlock > 0) U.txt(`🛡️${c.pBlock}`, 196, 20, 14, BLU, 'left');
  if (c.pPsnT > 0) U.txt(`☠️${c.pPsnT}`, 196, 38, 12, '#a8e06a', 'left');
  U.txt(c.kind === 'boss' ? '🐉 BOSS' : c.kind === 'ambush' ? '☠️ AMBUSH' : `Turn ${c.turn}`, 406, 18, 13, c.kind === 'fight' ? DIM : GOLD, 'right', c.kind !== 'fight');
  U.txt(`💰${P.gold}`, 406, 38, 13, GOLD, 'right');

  // move reach + targets for the current mode
  const reachMap = (myTurn && c.mode === 'move') ? reach(c, c.px, c.py, c.ap) : null;
  const aTargets = (myTurn && c.mode === 'atk') ? atkTargets() : [];
  const slot = c.mode === 'sk0' ? 0 : c.mode === 'sk1' ? 1 : -1;
  const sTargets = (myTurn && slot >= 0) ? skillTargets(slot) : [];
  const sSkill = slot >= 0 ? skillFor(slot) : null;
  const bTargets = (myTurn && c.mode === 'bomb') ? bombTargets() : [];

  // board
  U.panel(BX - 3, BY - 3, CW * T + 6, CH * T + 6, 8, '#0a0a10', '#33334a');
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      const [px, py] = tileXY(x, y);
      U.ctx.fillStyle = (x + y) % 2 ? '#14141d' : '#17171f';
      U.ctx.fillRect(px, py, T, T);
      if (wallAt(c, x, y)) {
        U.ctx.fillStyle = '#0c0c12';
        U.ctx.fillRect(px, py, T, T);
        U.txt('🪨', px + T / 2, py + T / 2 + 1, 26);
      } else if (reachMap && reachMap.has(k(x, y))) {
        U.ctx.fillStyle = 'rgba(232,180,90,0.2)';
        U.ctx.fillRect(px + 2, py + 2, T - 4, T - 4);
      }
      if (sSkill && sSkill.tgt === 'tile' && sTargets.some(q => q.x === x && q.y === y)) {
        U.ctx.fillStyle = 'rgba(179,157,255,0.18)';
        U.ctx.fillRect(px + 2, py + 2, T - 4, T - 4);
      }
      U.hit(px, py, T, T, () => tapBoard(x, y));
    }
  }
  // traps / chests / ground items
  for (const tr of c.traps) {
    const [px, py] = tileXY(tr.x, tr.y);
    U.ctx.globalAlpha = tr.sprung ? 0.18 : 0.9;
    U.txt('🔺', px + T / 2, py + T / 2 + 2, 20);
    U.ctx.globalAlpha = 1;
  }
  for (const ch of c.chests) {
    const [px, py] = tileXY(ch.x, ch.y);
    U.txt(ch.opened ? '📭' : '📦', px + T / 2, py + T / 2, 26);
  }
  for (const it of c.items) {
    if (it.taken) continue;
    const [px, py] = tileXY(it.x, it.y);
    U.txt(it.t === 'gold' ? '💰' : getItem(it.id).emoji, px + T / 2, py + T / 2, 20);
  }
  // player
  {
    const [px, py] = tileXY(c.px, c.py);
    U.txt('🤺', px + T / 2, py + T / 2, 32);
    if (c.pBlock > 0) U.txt(`🛡️${c.pBlock}`, px + T / 2, py + 8, 10, BLU);
  }
  // foes
  c.foes.forEach((f, i) => {
    if (f.dead) return;
    const m = MONSTERS[f.mid];
    const [px, py] = tileXY(f.x, f.y);
    const targeted = aTargets.includes(i) || bTargets.includes(i) || (sSkill && sSkill.tgt === 'foe' && sTargets.includes(i));
    if (targeted) {
      U.rr(px + 3, py + 3, T - 6, T - 6, 10);
      U.ctx.strokeStyle = aTargets.includes(i) ? RED : bTargets.includes(i) ? '#ffab4a' : PUR;
      U.ctx.lineWidth = 2.5;
      U.ctx.stroke();
    }
    if (c.phase === 'enemy' && c.ei === i) {
      U.rr(px + 2, py + 2, T - 4, T - 4, 10);
      U.ctx.strokeStyle = '#ffffff';
      U.ctx.lineWidth = 2;
      U.ctx.stroke();
    }
    U.txt(m.emoji, px + T / 2, py + T / 2 + 2, 32);
    U.txt('❓', px + T - 8, py + 9, 9);
    U.bar(px + 6, py + T - 8, T - 12, 5, f.hp / f.maxHp, '#b34a44');
    const chips = [];
    if (f.block > 0) chips.push(`🛡️${f.block}`);
    if (f.buff > 0) chips.push(`💢`);
    if (f.psnT > 0) chips.push(`☠️`);
    if (f.stun > 0) chips.push(`🧊`);
    if (chips.length) U.txt(chips.join(''), px + 4, py + 8, 10, TXT, 'left');
  });

  // status row: AP pips + phase
  for (let i = 0; i < P.apMax; i++) {
    U.ctx.beginPath();
    U.ctx.arc(24 + i * 22, 496, 8, 0, Math.PI * 2);
    U.ctx.fillStyle = i < c.ap ? '#7fe08a' : '#22222f';
    U.ctx.fill();
  }
  U.txt('AP', 24 + P.apMax * 22, 497, 13, DIM, 'left');
  U.txt(myTurn ? 'Your move' : 'Enemy turn…', 406, 497, 14, myTurn ? '#7fe08a' : RED, 'right', true);

  (c.lines || []).slice(-2).forEach((s, i) => U.txt(s, 14, 518 + i * 17, 12, DIM, 'left'));

  // action bar
  const dis = !myTurn;
  const selStroke = (on) => on ? GOLD : undefined;
  U.button(14, 552, 76, 62, '🚶', () => setMode('move'), { size: 22, sub: 'Move', disabled: dis, stroke: selStroke(c.mode === 'move') });
  U.button(94, 552, 76, 62, w.emoji, () => setMode('atk'), { size: 22, sub: `Atk ${w.ap}⚡`, disabled: dis || c.ap < w.ap, stroke: selStroke(c.mode === 'atk') });
  for (const s2 of [0, 1]) {
    const sk = skillFor(s2);
    const x = 174 + s2 * 80;
    if (!sk) {
      U.panel(x, 552, 76, 62, 14, '#12121b', '#22222f');
      U.txt('·', x + 38, 583, 18, '#33333f');
      continue;
    }
    const issue = skillIssue(s2);
    U.button(x, 552, 76, 62, sk.emoji, () => {
      if (skillIssue(s2)) return;
      if (sk.tgt === 'self' || sk.tgt === 'burst') castSkill(s2);
      else setMode('sk' + s2);
    }, { size: 22, sub: issue || `${sk.ap}⚡${sk.mp}🔮`, disabled: dis || !!issue, stroke: selStroke(c.mode === 'sk' + s2) });
  }
  const defGain = 2 + (getSecondary().block || 0) + getArmor().def;
  U.button(334, 552, 72, 62, '🛡️', defend, { size: 22, sub: c.defended ? 'used' : `+${defGain}·1⚡`, disabled: dis || c.ap < 1 || !!c.defended });

  // potions + end turn
  for (let i = 0; i < 3; i++) {
    const x = 14 + i * 90;
    const id = P.potions[i];
    if (id) {
      const p = POTIONS[id];
      U.button(x, 622, 84, 62, p.emoji, () => usePotion(i), {
        size: 24, sub: p.name.split(' ')[0], disabled: dis || c.ap < 1,
        stroke: (c.mode === 'bomb' && c.potIdx === i) ? GOLD : undefined,
      });
    } else {
      U.panel(x, 622, 84, 62, 14, '#12121b', '#22222f');
      U.txt('·', x + 42, 653, 18, '#33333f');
    }
  }
  U.button(288, 622, 118, 62, 'END', endTurn, { size: 19, sub: 'turn', fill: '#3a2f1c', stroke: '#8a6f3a', disabled: dis });

  const hint = !myTurn ? '' :
    c.mode === 'atk' ? 'Tap a highlighted foe to strike' :
    c.mode === 'sk0' || c.mode === 'sk1' ? 'Tap a target' :
    c.mode === 'bomb' ? 'Tap a foe in range to throw' :
    'Tap a tile to move · tap a foe to inspect ❓';
  U.txt(hint, 210, 706, 12, DIM);

  if (c.info >= 0 && c.foes[c.info]) foeInfo(c.foes[c.info]);
}

function describeMove(mv) {
  if (mv.t === 'melee') return `${mv.dmg} dmg · melee · ${mv.ap} AP${mv.psn ? ' · poisons' : ''}`;
  if (mv.t === 'rng') return `${mv.dmg} dmg · range ${mv.rng} · ${mv.ap} AP`;
  if (mv.t === 'guard') return `+${mv.block} block · ${mv.ap} AP`;
  return `+${mv.atk} ATK once · ${mv.ap} AP`;
}

function foeInfo(f) {
  const m = MONSTERS[f.mid];
  U.ctx.fillStyle = 'rgba(5,5,10,0.72)';
  U.ctx.fillRect(0, 0, U.W, U.H);
  const h = 150 + m.moves.length * 26 + 40;
  const y0 = 220;
  U.panel(30, y0, 360, h, 18, '#1a1a28', '#4a4a68');
  U.txt(m.emoji, 76, y0 + 46, 40);
  U.txt(m.name, 110, y0 + 34, 20, TXT, 'left', true);
  U.txt(`❤️ ${f.hp}/${f.maxHp}   🛡️ DEF ${m.def}   ⚡ ${m.ap} AP`, 110, y0 + 60, 13, DIM, 'left');
  U.txt('Moves', 52, y0 + 100, 14, GOLD, 'left', true);
  m.moves.forEach((mv, i) => {
    U.txt(`${mv.emoji} ${mv.name}`, 52, y0 + 126 + i * 26, 14, TXT, 'left');
    U.txt(describeMove(mv), 368, y0 + 126 + i * 26, 12, DIM, 'right');
  });
  const st = [];
  if (f.buff > 0) st.push(`💢 +${f.buff} ATK`);
  if (f.psnT > 0) st.push(`☠️ poison ${f.psn}×${f.psnT}`);
  if (f.stun > 0) st.push('🧊 frozen');
  if (f.block > 0) st.push(`🛡️ ${f.block} block`);
  if (st.length) U.txt(st.join('   '), 52, y0 + 126 + m.moves.length * 26, 12, '#ff9b6b', 'left');
  U.txt('tap anywhere to close', 210, y0 + h - 18, 11, DIM);
  U.hit(0, 0, U.W, U.H, closeInfo);
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
        size: 15, fill: sk ? '#2c2c44' : '#14141d', stroke: sk ? GOLD : '#2c2c40', sub: sk ? `${sk.ap}⚡ ${sk.mp}🔮` : `slot ${s + 1}`,
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
    U.txt(`${sk.ap} AP · ${sk.mp} MP`, 84, y + 78, 11, PUR, 'left');
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
  U.txt('Grid battles: spend AP to move, strike, and cast.', 210, 636, 13, DIM);
  U.txt('Loot every foe. Craft. Slay the dragon on floor 8.', 210, 658, 13, DIM);
  U.txt('v0.2 · built with Claude', 210, 774, 11, '#55536a');
}

function endScreen(emoji, label, color) {
  U.txt(emoji, 210, 230, 88);
  U.txt(label, 210, 330, 36, color, 'center', true);
  const s = G.stats || { floor: 0, kills: 0, goldEarned: 0 };
  U.txt(`Reached floor ${s.floor}/8`, 210, 396, 16, TXT);
  U.txt(`Foes slain: ${s.kills}`, 210, 424, 16, TXT);
  U.txt(`Gold earned: ${s.goldEarned}`, 210, 452, 16, TXT);
  U.txt(`Skills known: ${G.player ? G.player.known.length : 0}/10`, 210, 480, 16, TXT);
  U.button(110, 560, 200, 60, 'New Run', () => newRun(), { size: 20 });
}
