# ⚔️ DEPTHS — a pocket tactics roguelike

Climb 10 floors of a heavily branching dungeon. Choose your path (fights,
❓ events, treasure, merchants), then scout each battle-map before you commit:
scroll around the rooms and hallways, tap enemies to see their walk range and
full movesets (red flash = they can reach you), and swap your gear and skills —
then begin. Spend AP to move (green tiles show your reach) and strike with
your weapon: diagonals count, fleeing melee provokes opportunity attacks both
ways, and walls, boulders, urns, and traps all have HP and can be smashed.
Cast your two equipped skills (mana + cooldowns), drink potions, shove foes
into spikes, and loot chests mid-fight. Every room rolls different: big or
cramped, bare or cluttered, and each enemy may start alert or asleep. Every
foe drops gear — equip it, sell it, or break it into scrap and craft weapons,
armor, potions, and new skills. Slay the dragon on floor 10. Death is
permanent. Runs are short.

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
