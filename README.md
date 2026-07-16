# ⚔️ DEPTHS — a pocket tactics roguelike

Climb 10 floors of a heavily branching dungeon. Choose your path (fights,
❓ events, treasure, merchants), then delve VAST hexagonal caverns — every
battle-map is a freshly generated labyrinth of halls, winding corridors, and
caves, up to a hundred hexes across. Scout before you commit: scroll the whole
map (pinch to zoom, drag to pan), tap enemies to see their walk range and
full movesets (red flash = they can reach you), and swap gear and skills.
Every enemy dozes on its own 0-4 turn timer — sneak while they sleep, and
watch reinforcements wake mid-fight. While nothing threatens you, explore
freely with long strides and a compass pointing to the nearest foe; the moment
something stirs, the AP economy kicks in — move hex by hex (green shows your
reach), strike any of the 6 directions, and mind opportunity attacks when you
flee melee. Rock walls, boulders, urns, and traps all have HP: dig shortcuts,
dismantle spikes, smash pottery for gold. Cast your two equipped skills
(mana + cooldowns), shove foes into traps, loot chests mid-fight. Enemies may
start alert or asleep, clustered room by room. Every foe drops gear — equip
it, sell it, or break it into scrap and craft weapons, armor, potions, and new
skills. Slay the dragon on floor 10. Death is permanent.

**Play it:** https://adaford.github.io/depths/

Built for phones: portrait, all-touch, no install. Add it to your home screen for
a fullscreen app feel. Progress auto-saves, so closing the tab mid-run is safe.

## Development

No build tools, no dependencies — plain HTML + ES modules on a canvas.

- **Run locally:** double-click `serve.bat` (or `python -m http.server 8000`),
  then open `http://localhost:8000`. From a phone on the same Wi-Fi, use this
  PC's LAN IP instead of `localhost`.
- **Deploy:** push to `main`; GitHub Pages redeploys in about a minute.
- **Test:** `node test/smoke.mjs` simulates 300 full runs headlessly and checks
  invariants (also prints win-rate — handy when tuning difficulty).

### Where things live

| File | What's in it |
|---|---|
| `js/data.js` | All content: monsters + movesets, weapons, shields, armor, potions, skills, craft recipes. Tune here first. |
| `js/game.js` | Run state, map generation, events, shop, inventory/crafting, save/load |
| `js/combat.js` | Tactical grid combat: room generation, AP actions, enemy AI |
| `js/grid.js` | Board pathfinding and spatial helpers |
| `js/screens.js` | Every screen's rendering + touch targets |
| `js/ui.js` | Canvas scaling and drawing helpers |

🤖 Built with [Claude Code](https://claude.com/claude-code)
