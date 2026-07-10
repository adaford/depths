# DEPTHS — project conventions

Mobile-first emoji roguelike with tactical grid battles. Plain HTML + vanilla JS
ES modules on a single canvas. **No build step, no dependencies, no TypeScript**
— the owner iterates from their phone and deploys are just `git push`.

## Iteration loop
- Local test: `serve.bat` / `python -m http.server 8000` (phone uses PC's LAN IP).
- Deploy: commit and push to `main` → GitHub Pages updates in ~1 minute at
  https://adaford.github.io/depths/
- Before pushing gameplay changes, run `node test/smoke.mjs` (simulates 300 runs,
  checks invariants, prints win-rate — keep win-rate roughly in the 15–45% band
  when tuning).

## Architecture rules
- Logical canvas is 420x800 portrait, letterboxed (`js/ui.js`). All coordinates
  are in logical units.
- Immediate-mode UI: every frame redraws and re-registers tap regions via
  `U.button`/`U.hit`. No DOM elements, no event listeners per widget.
- `G` in `js/game.js` is the whole game state and must stay JSON-serializable —
  it is persisted verbatim to localStorage (`depths_save_4`). No class instances,
  functions, or absolute timestamps inside `G` (relative `_due` is reset on load).
  If you change the save schema incompatibly, bump the key and the `v` field.
- All content (monsters + movesets, gear, potions, skills, craft recipes, node
  emoji) is data in `js/data.js`; gameplay code is data-driven off those tables.
  Add content there, not in logic.
- Combat is a variable-size dungeon of rooms + hallways (`js/combat.js` rules,
  `js/grid.js` BFS/pathing), viewed through a scrollable camera (drag to pan;
  `U.dragZone` in `js/ui.js` decides tap vs drag). Fights open in a `prep`
  scout phase (look around, inspect foes, swap build) before turn 1. Everything
  costs AP; attack ranges are chebyshev (diagonals count); leaving a melee
  reach provokes an opportunity attack both ways; walls/obstacles/traps have hp
  and are attackable (the map border is not); foes roll asleep per-monster
  (`nap`) and wake within AGRO range or when hurt. Enemy turns advance one
  micro-action per `tick()` beat. Dungeons must stay fully connected — walls,
  chests, AND obstacles block movement, so any new blocker must be part of the
  `connectedFloors` check.
- Touch targets ≥ 56px. Emoji are the art style — no image assets.
- Screens: TITLE, MAP, COMBAT, CHOICE (loot/rest/events share it), SHOP, INV,
  SKILLS, CRAFT, GAMEOVER, VICTORY.
