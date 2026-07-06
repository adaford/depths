# ⚔️ DEPTHS — a pocket roguelike

Climb 8 floors of a branching dungeon. Choose your path (fights, elites, treasure,
campfires, merchants), read enemy intents in turn-based combat, collect weapons,
armor, and potions — then slay the dragon. Death is permanent. Runs are short.

**Play it:** https://adaford.github.io/depths/

Built for phones: portrait, all-touch, no install. Add it to your home screen for
a fullscreen app feel. Progress auto-saves, so closing the tab mid-run is safe.

## Development

No build tools, no dependencies — plain HTML + ES modules on a canvas.

- **Run locally:** double-click `serve.bat` (or `python -m http.server 8000`),
  then open `http://localhost:8000`. From a phone on the same Wi-Fi, use this
  PC's LAN IP instead of `localhost`.
- **Deploy:** push to `main`; GitHub Pages redeploys in about a minute.
- **Test:** `node test/smoke.mjs` simulates 200 full runs headlessly and checks
  invariants (also prints win-rate — handy when tuning difficulty).

### Where things live

| File | What's in it |
|---|---|
| `js/data.js` | All content: monsters, weapons, armor, potions. Tune here first. |
| `js/game.js` | Run state, map generation, loot/shop/rest choices, save/load |
| `js/combat.js` | Turn-based combat rules |
| `js/screens.js` | Every screen's rendering + touch targets |
| `js/ui.js` | Canvas scaling and drawing helpers |

🤖 Built with [Claude Code](https://claude.com/claude-code)
