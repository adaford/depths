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
  it is persisted verbatim to localStorage (`depths_save_6`). No class instances,
  functions, or absolute timestamps inside `G` (relative `_due` is reset on load).
  If you change the save schema incompatibly, bump the key and the `v` field.
- All content (monsters + movesets, gear, potions, skills, craft recipes, node
  emoji) is data in `js/data.js`; gameplay code is data-driven off those tables.
  Add content there, not in logic.
- Combat is a huge HEX dungeon (60-100 hexes a side; rooms, corridors, or caves
  — generator style rolls per fight) viewed through a scrollable camera (drag
  to pan; `U.dragZone` in `js/ui.js` decides tap vs drag). Tiles are pointy-top
  hexes in odd-r offset coords — ALL geometry (neighbors, distance, pixel
  conversion, BFS) goes through `js/grid.js`; never hand-roll dx/dy math. The
  board is solid rock with carved floors: `c.floors` is the walkable list,
  `c.wallDmg` tracks chipped rock, digging pushes into `floors` + `dug`.
  The camera pans by drag and zooms by pinch or mouse wheel (`U.dragZone`
  pinch handler). Fights open in a `prep` scout phase (look around, inspect
  foes, swap build); while no awake foe is within `ENGAGE_R` you EXPLORE
  (moves free, `EXPLORE_STEPS` stride, foe compass) and the AP economy starts
  on engagement (with `CHASE_R` pursuit hysteresis — no free-move kiting).
  Every foe rolls a 0-4 turn sleep timer at battle start; timers tick down
  during enemy phases, and proximity (AGRO) or damage wakes instantly. Awake
  foes beyond `FAR` march silently without beats. Leaving melee reach provokes
  opportunity attacks both ways; rock/obstacles/traps have hp and are
  attackable (map border is not). Enemy turns advance one micro-action per
  `tick()` beat. Dungeons must stay fully connected — obstacles and chests
  block movement, so any new blocker must pass the placement connectivity
  check in `startCombat`.
- Touch targets ≥ 56px. Emoji are the art style — no image assets.
- Screens: TITLE, MAP, COMBAT, CHOICE (loot/rest/events share it), SHOP, INV,
  SKILLS, CRAFT, GAMEOVER, VICTORY.
