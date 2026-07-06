// All screen rendering. Immediate-mode: each frame redraws and re-registers tap targets.
import * as U from './ui.js';
import {
  G, canContinue, continueRun, newRun, reachable, enterNode,
  pickOption, skipOption, optionDisabled, playerWeapon, playerArmor, goto,
} from './game.js';
import { doAttack, doDefend, usePotion, intent, FX } from './combat.js';
import { MONSTERS, POTIONS, NODE_EMOJI } from './data.js';

const GOLD = '#e8b45a', DIM = '#8a8798', TXT = '#e8e4da';

// convert combat events into floating numbers at screen positions
function drainFX() {
  for (const ev of FX.splice(0)) {
    if (ev.t === 'e') U.addFloat(210, 175, ev.v, '#ffd76a');
    else if (ev.t === 'eb') U.addFloat(210, 175, ev.v, '#7fc7ff');
    else if (ev.t === 'ebf') U.addFloat(210, 175, ev.v, '#ff9b6b');
    else if (ev.t === 'p') U.addFloat(210, 455, ev.v, '#ff7b6b');
    else if (ev.t === 'pb') U.addFloat(210, 455, ev.v, '#7fc7ff');
    else if (ev.t === 'ph') U.addFloat(210, 455, ev.v, '#7fe08a');
    else if (ev.t === 'ps') U.addFloat(210, 455, ev.v, '#ffd76a');
  }
}

export function render(t, dt) {
  U.frameStart();
  drainFX();
  if (G.screen === 'TITLE') title();
  else if (G.screen === 'MAP') map(t);
  else if (G.screen === 'COMBAT') combat(t);
  else if (G.screen === 'CHOICE') choice();
  else if (G.screen === 'GAMEOVER') endScreen('💀', 'You Died', '#d9534f');
  else if (G.screen === 'VICTORY') endScreen('👑', 'Victory!', GOLD);
  U.drawFloats(dt);
}

function header(showMenu) {
  const p = G.player;
  U.txt(`Floor ${G.stats.floor}/8`, 14, 26, 15, DIM, 'left');
  U.txt(`❤️ ${p.hp}/${p.maxHp}`, 210, 26, 15, TXT, 'center');
  U.txt(`💰 ${p.gold}`, showMenu ? 356 : 406, 26, 15, GOLD, 'right');
  if (showMenu) U.button(372, 8, 36, 34, '≡', () => { G.back = 'MAP'; goto('TITLE'); }, { size: 20 });
}

function map(t) {
  header(true);
  const nodes = G.map.nodes;
  const reach = reachable();
  U.ctx.lineWidth = 3;
  for (const n of nodes) {
    for (const j of n.next) {
      const m = nodes[j];
      const dx = m.x - n.x, dy = m.y - n.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      U.ctx.strokeStyle = (n.i === G.cur && reach.includes(j)) ? GOLD : '#2b2b40';
      U.ctx.beginPath();
      U.ctx.moveTo(n.x + ux * 28, n.y + uy * 28);
      U.ctx.lineTo(m.x - ux * 28, m.y - uy * 28);
      U.ctx.stroke();
    }
  }
  if (G.cur < 0) {
    for (const i of reach) {
      const m = nodes[i];
      const dx = m.x - 210, dy = m.y - 700;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      U.ctx.strokeStyle = GOLD;
      U.ctx.beginPath();
      U.ctx.moveTo(210 + ux * 26, 700 + uy * 26);
      U.ctx.lineTo(m.x - ux * 28, m.y - uy * 28);
      U.ctx.stroke();
    }
    U.txt('🤺', 210, 700, 30);
  }
  const pulse = 2 + Math.sin(t / 220) * 1.5;
  for (const n of nodes) {
    const rad = n.type === 'BOSS' ? 30 : 24;
    const isReach = reach.includes(n.i);
    const isCur = n.i === G.cur;
    if (n.done && !isCur) U.ctx.globalAlpha = 0.45;
    U.ctx.beginPath();
    U.ctx.arc(n.x, n.y, rad, 0, Math.PI * 2);
    U.ctx.fillStyle = '#1d1d2c';
    U.ctx.fill();
    U.ctx.lineWidth = isReach ? pulse : 2;
    U.ctx.strokeStyle = isCur ? '#ffffff' : isReach ? GOLD : '#3a3a4f';
    U.ctx.stroke();
    U.txt(NODE_EMOJI[n.type], n.x, n.y + 1, n.type === 'BOSS' ? 30 : 22);
    U.ctx.globalAlpha = 1;
    if (isCur) U.txt('🤺', n.x, n.y - rad - 16, 22);
    if (isReach) U.hit(n.x - 32, n.y - 32, 64, 64, () => enterNode(n.i));
  }
  U.txt('Tap a glowing node to travel', 210, 762, 13, DIM);
}

function combat(t) {
  const c = G.combat;
  if (!c) { goto('MAP'); return; }
  const m = MONSTERS[c.mid];
  header(false);
  U.txt(`Turn ${c.turn}`, 406, 48, 12, DIM, 'right');
  if (c.kind !== 'fight') {
    U.txt(c.kind === 'boss' ? '🐉 BOSS' : '☠️ ELITE', 210, 60, 13, c.kind === 'boss' ? GOLD : '#ff9b6b', 'center', true);
  }
  U.txt(m.name, 210, 92, 21, TXT, 'center', true);
  U.txt(m.emoji, 210, 170, 92);
  U.bar(80, 236, 260, 18, c.ehp / c.emax, '#b34a44', `${Math.max(0, c.ehp)}/${c.emax}`);
  const chips = [];
  if (c.eblock > 0) chips.push([`🛡️ ${c.eblock}`, '#7fc7ff']);
  if (c.ebuff > 0) chips.push([`💢 +${c.ebuff}`, '#ff9b6b']);
  chips.forEach((ch, i) => U.txt(ch[0], 210 + (i - (chips.length - 1) / 2) * 90, 268, 14, ch[1]));
  const it = intent();
  U.panel(140, 288, 140, 34, 17, '#1a1a28', '#34344e');
  U.txt(`Next: ${it.icon} ${it.txt}`, 210, 306, 15, TXT);
  (c.lines || []).slice(-2).forEach((s, i) => U.txt(s, 210, 348 + i * 20, 13, DIM));

  U.panel(12, 400, 396, 172, 16, '#15151f', '#26263a');
  U.bar(28, 418, 232, 20, G.player.hp / G.player.maxHp, '#4f9d57', `${G.player.hp}/${G.player.maxHp}`);
  if (c.pBlock > 0) U.txt(`🛡️ ${c.pBlock}`, 272, 428, 15, '#7fc7ff', 'left');
  if (c.pStr > 0) U.txt(`💪 +${c.pStr}`, 348, 428, 15, GOLD, 'left');
  const w = playerWeapon(), a = playerArmor();
  U.txt(`${w.emoji} ${w.name} +${w.atk}`, 28, 466, 14, TXT, 'left');
  U.txt(`${a.emoji} ${a.name} +${a.def}`, 28, 492, 14, TXT, 'left');
  U.txt(c.phase === 'player' ? 'Your move' : 'Enemy turn…', 396, 466, 13, c.phase === 'player' ? '#7fe08a' : DIM, 'right');

  const dis = c.phase !== 'player';
  U.button(12, 584, 194, 72, '⚔️ ATTACK', doAttack, { fill: '#542a2a', stroke: '#a05050', size: 21, disabled: dis });
  U.button(214, 584, 194, 72, '🛡️ DEFEND', doDefend, { fill: '#24405c', stroke: '#5b8ab8', size: 21, disabled: dis });
  for (let i = 0; i < 3; i++) {
    const x = 12 + i * 135;
    const id = G.player.potions[i];
    if (id) {
      const p = POTIONS[id];
      U.button(x, 668, 126, 64, p.emoji, () => usePotion(i), { size: 26, sub: p.name.split(' ')[0], disabled: dis });
    } else {
      U.panel(x, 668, 126, 64, 14, '#12121b', '#22222f');
      U.txt('·', x + 63, 700, 20, '#33333f');
    }
  }
}

function choice() {
  const p = G.pending;
  if (!p) { goto('MAP'); return; }
  header(false);
  U.txt(p.title, 210, 116, 26, TXT, 'center', true);
  if (p.sub) U.txt(p.sub, 210, 152, 15, DIM);
  p.options.forEach((o, i) => {
    const y = 192 + i * 112;
    const why = optionDisabled(o);
    if (why) U.ctx.globalAlpha = 0.45;
    U.panel(24, y, 372, 98, 16, '#1c1c2b', '#34344e');
    U.txt(o.emoji, 66, y + 49, 38);
    U.txt(o.label, 104, y + 32, 19, TXT, 'left', true);
    U.txt(o.desc, 104, y + 64, 13, DIM, 'left');
    if (o.act.t === 'buy' && !o.sold) {
      U.txt(`💰${o.act.price}`, 388, y + 32, 16, G.player.gold >= o.act.price ? GOLD : '#d9534f', 'right', true);
    }
    if (o.sold) U.txt('SOLD', 388, y + 32, 15, DIM, 'right', true);
    U.ctx.globalAlpha = 1;
    if (why === 'Potions full') U.txt(why, 388, y + 64, 12, '#d9534f', 'right');
    if (!why) U.hit(24, y, 372, 98, () => pickOption(i));
  });
  if (p.canSkip) U.button(110, 664, 200, 56, p.canSkip, skipOption, { size: 17 });
}

function title() {
  U.txt('⚔️', 210, 235, 84);
  U.txt('DEPTHS', 210, 330, 52, GOLD, 'center', true);
  U.txt('a pocket roguelike', 210, 372, 15, DIM);
  if (canContinue()) {
    U.button(110, 448, 200, 60, 'Continue', continueRun, { size: 20, fill: '#2a3a2a', stroke: '#4f7a4f' });
  }
  U.button(110, canContinue() ? 526 : 470, 200, 60, 'New Run', () => newRun(), { size: 20 });
  U.txt('⚔️ fight   💰 treasure   ⛺ rest   🛒 shop', 210, 640, 13, DIM);
  U.txt("Climb 8 floors. Slay the dragon. Don't die.", 210, 664, 13, DIM);
  U.txt('v0.1 · built with Claude', 210, 774, 11, '#55536a');
}

function endScreen(emoji, label, color) {
  U.txt(emoji, 210, 230, 88);
  U.txt(label, 210, 330, 36, color, 'center', true);
  const s = G.stats || { floor: 0, kills: 0, goldEarned: 0 };
  U.txt(`Reached floor ${s.floor}/8`, 210, 396, 16, TXT);
  U.txt(`Monsters slain: ${s.kills}`, 210, 424, 16, TXT);
  U.txt(`Gold earned: ${s.goldEarned}`, 210, 452, 16, TXT);
  U.button(110, 540, 200, 60, 'New Run', () => newRun(), { size: 20 });
}
