# DEPTHS — project conventions

Mobile-first emoji roguelike. Plain HTML + vanilla JS ES modules on a single
canvas. **No build step, no dependencies, no TypeScript** — the owner iterates
from their phone and deploys are just `git push`.

## Iteration loop
- Local test: `serve.bat` / `python -m http.server 8000` (phone uses PC's LAN IP).
- Deploy: commit and push to `main` → GitHub Pages updates in ~1 minute at
  https://adaford.github.io/depths/
- Before pushing gameplay changes, run `node test/smoke.mjs` (simulates 200 runs,
  checks invariants, prints win-rate — keep win-rate roughly in the 15–45% band
  when tuning).

## Architecture rules
- Logical canvas is 420x800 portrait, letterboxed (`js/ui.js`). All coordinates
  are in logical units.
- Immediate-mode UI: every frame redraws and re-registers tap regions via
  `U.button`/`U.hit`. No DOM elements, no event listeners per widget.
- `G` in `js/game.js` is the whole game state and must stay JSON-serializable —
  it is persisted verbatim to localStorage (`depths_save_1`). No class instances,
  functions, or absolute timestamps inside `G` (relative `_due` is reset on load).
  If you change the save schema incompatibly, bump the key and the `v` field.
- All content (monsters, gear, potions, node emoji) is data in `js/data.js`;
  gameplay code is data-driven off those tables. Add content there, not in logic.
- Touch targets ≥ 56px. Emoji are the art style — no image assets.
- Screens: TITLE, MAP, COMBAT, CHOICE (loot/rest/shop share it), GAMEOVER, VICTORY.
