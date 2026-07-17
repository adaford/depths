# DEPTHS — project conventions

Mobile-first emoji roguelike with tactical grid battles. Plain HTML + vanilla JS
ES modules on a single canvas. **No build step, no dependencies, no TypeScript**
— the owner iterates from their phone and deploys are just `git push`.

## Iteration loop
- Local test: `serve.bat` / `python -m http.server 8000` (phone uses PC's LAN IP).
- Deploy: commit and push to `main` → GitHub Pages updates in ~1 minute at
  https://adaford.github.io/depths/
- **ALWAYS deploy every verified change round to `main`** — the owner playtests
  exclusively on the live GitHub Pages build from their phone; work sitting on
  an unmerged branch is invisible to them. Verify (smoke + browser check),
  then merge and confirm it's live — don't wait to be asked.
- Before pushing gameplay changes, run `node test/smoke.mjs` (simulates 300 runs,
  checks invariants, prints win-rate — keep win-rate roughly in the 15–45% band
  when tuning).

## Architecture rules
- Logical canvas is 420x800 portrait, letterboxed (`js/ui.js`). All coordinates
  are in logical units.
- Immediate-mode UI: every frame redraws and re-registers tap regions via
  `U.button`/`U.hit`. No DOM elements, no event listeners per widget.
  Text must never leave the canvas: pass `maxW` to `U.txt` (shrink-then-ellipsize)
  or use `U.wrap` for descriptions. Draw emoji with `U.emo` — it centers the
  measured ink bounds on the point (baseline `middle` sits emoji off-center).
- `G` in `js/game.js` is the whole game state and must stay JSON-serializable —
  it is persisted verbatim to localStorage (`depths_save_7`). No class instances,
  functions, or absolute timestamps inside `G` (relative `_due` is reset on load).
  If you change the save schema incompatibly, bump the key and the `v` field.
- All content (monsters + movesets, gear, potions, skills, craft recipes, node
  emoji) is data in `js/data.js`; gameplay code is data-driven off those tables.
  Add content there, not in logic.
- Combat is a dense SQUARE-grid dungeon (26-44 tiles a side; rooms, corridors,
  or caves — generator style rolls per fight) viewed through a scrollable
  camera (drag to pan, pinch/wheel to zoom; `U.dragZone` in `js/ui.js` decides
  tap vs drag vs pinch). ALL geometry (4-dir movement, chebyshev ranges, pixel
  conversion, BFS, Bresenham line of sight) goes through `js/grid.js`; never
  hand-roll dx/dy math. The board is solid rock with carved floors: `c.floors`
  is the walkable list, `c.wallDmg` tracks chipped rock, digging pushes into
  `floors` + `dug`. Tapping ANYTHING on the board inspects it (`c.sel` for foes,
  `c.insp` for obstacles/traps/chests/items/rock): foes show walk range + sight
  field + a stat/moveset panel over the board bottom, objects show a description
  panel whose button carries the action (Open / Smash / Dig / Go grab) — plain
  taps never trigger actions on objects. Fights open in a `prep` scout phase
  (look around, inspect, swap build); while no awake foe is within `ENGAGE_R`
  you EXPLORE
  (moves free, `EXPLORE_STEPS` stride, foe compass) and the AP economy starts
  on engagement (with `CHASE_R` pursuit hysteresis — no free-move kiting).
  Every foe has a per-type `sight` range (data.js): seeing the player (hex
  distance ≤ sight AND clear LoS — rock and TALL obstacles block sight; `low`
  obstacles like 🪨 rocks and ⚱️ urns only block movement, and obstacles often
  spawn in multi-tile formations) wakes and
  alerts it; every foe also rolls a 0-4 turn sleep timer that ticks during
  enemy phases; damage wakes instantly. RANGED attacks both ways require LoS.
  Every foe has a `face` direction (rendered as a dot): weapon hits from
  behind crit (`crit` on weapons, default 2x); Vanish (`c.pInvis`) blinds
  foes. Awake foes beyond `FAR` march silently without beats. Leaving melee
  reach provokes opportunity attacks both ways; rock/obstacles/traps have hp
  and are attackable (map border is not). Enemy turns advance one micro-action
  per `tick()` beat. Dungeons must stay fully connected — obstacles and chests
  block movement, so any new blocker must pass the placement connectivity
  check in `startCombat`.
- Touch targets ≥ 56px. Emoji are the art style — no image assets.
- Screens: TITLE, MAP, COMBAT, CHOICE (loot/rest/events share it), SHOP, INV,
  SKILLS, CRAFT, GAMEOVER, VICTORY.
