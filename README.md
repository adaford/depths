# ⚔️ DEPTHS — a pocket tactics roguelike

Climb 10 floors of a heavily branching dungeon. Choose your path (fights,
❓ events, treasure, merchants), then stalk dense grid dungeons — every
battle-map is a freshly generated labyrinth of cramped halls, chokepoint
corridors, and caves, crawling with packed dens, spike traps at the corridor
mouths, and cover that blocks LINE OF SIGHT. Every enemy has its own sight
range (a slime barely sees 3 tiles; the dragon sees 30) and a facing — sneak
around cover, strike from behind for CRIT damage (daggers hit 3x), or Vanish
and walk right past. Scout before you commit: scroll and pinch-zoom the map,
tap enemies to see exactly what they can see and where they can walk (red
flash = they can reach you), and swap gear and skills. Foes doze on 0-4 turn
timers and wake in waves; ranged attacks — yours and theirs — need clear
sight lines. Explore freely with a foe compass until something spots you,
then it's AP tactics: move, strike (diagonals count), Shove foes into spikes,
Leap over walls, Shadowstep behind backs, dig through rock. Every foe drops
gear — equip it, sell it, or scrap it and craft weapons, armor, potions, and
15 skills. Slay the dragon on floor 10. Death is permanent.

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
