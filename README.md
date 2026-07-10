# ⚔️ DEPTHS — a pocket tactics roguelike

Climb 8 floors of a branching dungeon. Choose your path (fights, ❓ events,
treasure, merchants), then battle on a 7×7 grid: spend AP to move, strike with
your weapon, cast the two skills you equipped, drink potions, spring traps on
your foes, and loot chests mid-fight. Tap any enemy to see its full moveset
before it acts. Every foe drops gear — equip it, sell it, or break it into
scrap and craft weapons, armor, potions, and new skills. Slay the dragon on
floor 8. Death is permanent. Runs are short.

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
