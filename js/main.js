import { initCanvas, pointerDown, pointerMove, pointerUp, pointerCancel } from './ui.js';
import { G, boot, save } from './game.js';
import { tick } from './combat.js';
import { render } from './screens.js';

const cnv = document.getElementById('c');
initCanvas(cnv);
boot();

cnv.addEventListener('pointerdown', (e) => { e.preventDefault(); pointerDown(e); });
window.addEventListener('pointermove', (e) => pointerMove(e));
window.addEventListener('pointerup', () => pointerUp());
window.addEventListener('pointercancel', () => pointerCancel());
window.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && G.player && !G.dead && !G.won) save();
});

let last = performance.now();
function loop(t) {
  const dt = Math.min(100, t - last);
  last = t;
  tick(t);
  render(t, dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
