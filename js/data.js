// All game content lives here. Tune numbers, add monsters/gear/skills/recipes freely —
// the rest of the code is data-driven off these tables.

// Primary weapons drive the ATTACK action: dmg per hit, rng in tiles (chebyshev), ap cost per swing.
// crit = backstab multiplier (default 2x when striking from behind); daggers excel at it.
export const WEAPONS = {
  w_dagger: { id: 'w_dagger', cat: 'w', name: 'Dagger',      emoji: '🗡️', dmg: 2,  ap: 1, rng: 1, crit: 3, tier: 1, price: 18 },
  w_club:   { id: 'w_club',   cat: 'w', name: 'Club',        emoji: '🏏', dmg: 4,  ap: 2, rng: 1, tier: 1, price: 20 },
  w_sword:  { id: 'w_sword',  cat: 'w', name: 'Sword',       emoji: '⚔️', dmg: 5,  ap: 2, rng: 1, tier: 2, price: 30 },
  w_spear:  { id: 'w_spear',  cat: 'w', name: 'Spear',       emoji: '🔱', dmg: 5,  ap: 2, rng: 2, tier: 2, price: 34 },
  w_bow:    { id: 'w_bow',    cat: 'w', name: 'Shortbow',    emoji: '🏹', dmg: 4,  ap: 2, rng: 4, tier: 2, price: 32 },
  w_axe:    { id: 'w_axe',    cat: 'w', name: 'Battle Axe',  emoji: '🪓', dmg: 7,  ap: 2, rng: 1, tier: 3, price: 40 },
  w_wand:   { id: 'w_wand',   cat: 'w', name: 'Storm Wand',  emoji: '🪄', dmg: 5,  ap: 2, rng: 3, tier: 3, price: 38 },
  w_xbow:   { id: 'w_xbow',   cat: 'w', name: 'Crossbow',    emoji: '🎯', dmg: 7,  ap: 3, rng: 4, tier: 4, price: 48 },
  w_hammer: { id: 'w_hammer', cat: 'w', name: 'Warhammer',   emoji: '🔨', dmg: 12, ap: 3, rng: 1, tier: 4, price: 46 },
  w_flame:  { id: 'w_flame',  cat: 'w', name: 'Flame Blade', emoji: '🔥', dmg: 8,  ap: 2, rng: 1, tier: 5, price: 58 },
};

// Secondary slot drives the DEFEND action: block gained per defend. thorns hits melee attackers back.
export const OFFHANDS = {
  s_wood:  { id: 's_wood',  cat: 's', name: 'Wood Shield',   emoji: '🪵', block: 4,  tier: 1, price: 14 },
  s_iron:  { id: 's_iron',  cat: 's', name: 'Iron Shield',   emoji: '🛡️', block: 7,  tier: 2, price: 26 },
  s_spike: { id: 's_spike', cat: 's', name: 'Spiked Shield', emoji: '🦔', block: 6, thorns: 3, tier: 3, price: 36 },
  s_tower: { id: 's_tower', cat: 's', name: 'Tower Shield',  emoji: '🏰', block: 10, tier: 4, price: 44 },
};

// def = flat damage reduction on every hit that gets through block (min 1 still lands).
export const ARMOR = {
  a_leather: { id: 'a_leather', cat: 'a', name: 'Leather Armor', emoji: '🥋', def: 1, tier: 1, price: 20 },
  a_chain:   { id: 'a_chain',   cat: 'a', name: 'Chainmail',     emoji: '⛓️', def: 2, tier: 2, price: 30 },
  a_plate:   { id: 'a_plate',   cat: 'a', name: 'Knight Plate',  emoji: '🦺', def: 3, tier: 3, price: 42 },
  a_scale:   { id: 'a_scale',   cat: 'a', name: 'Dragon Scale',  emoji: '🐲', def: 4, tier: 4, price: 54 },
};

// Potions cost 1 AP in combat. w = drop weight (relative rarity).
export const POTIONS = {
  p_heal:  { id: 'p_heal',  cat: 'p', name: 'Health Potion', emoji: '🧪', fx: 'heal',  v: 20, desc: 'Restore 20 HP',            price: 22, w: 40 },
  p_mana:  { id: 'p_mana',  cat: 'p', name: 'Mana Potion',   emoji: '🔮', fx: 'mana',  v: 8,  desc: 'Restore 8 MP',             price: 20, w: 25 },
  p_bomb:  { id: 'p_bomb',  cat: 'p', name: 'Fire Bomb',     emoji: '💣', fx: 'bomb',  v: 10, rng: 3, desc: '10 dmg at range 3, ignores block', price: 26, w: 20 },
  p_tonic: { id: 'p_tonic', cat: 'p', name: 'Barrier Tonic', emoji: '🧿', fx: 'block', v: 10, desc: 'Gain 10 block',            price: 22, w: 15 },
};

// Active skills. Two can be equipped (edit loadout from the map, or pre-fight).
// Weapon-based hits (attack, Power Strike, Whirlwind, Leap) crit from behind.
// Costs are AP + MP; cd = cooldown in turns after casting. Ranges are chebyshev
// (diagonals count). tgt: 'foe' tap an enemy in rng · 'tile' tap a tile ·
// 'self'/'burst' cast instantly.
export const SKILLS = {
  sk_power: { id: 'sk_power', cat: 'k', name: 'Power Strike', emoji: '💥', ap: 2, mp: 3, cd: 1, tgt: 'foe',  rng: 1, fx: 'wx2',            desc: '2× weapon damage to an adjacent foe' },
  sk_heal:  { id: 'sk_heal',  cat: 'k', name: 'Mend',         emoji: '💚', ap: 1, mp: 5, cd: 3, tgt: 'self',         fx: 'heal',  v: 12,   desc: 'Restore 12 HP' },
  sk_fire:  { id: 'sk_fire',  cat: 'k', name: 'Fireball',     emoji: '🔥', ap: 2, mp: 4, cd: 2, tgt: 'foe',  rng: 4, fx: 'dmg',   v: 10,   desc: '10 damage at range 4' },
  sk_bolt:  { id: 'sk_bolt',  cat: 'k', name: 'Storm Bolt',   emoji: '⚡', ap: 2, mp: 3, cd: 1, tgt: 'foe',  rng: 5, fx: 'dmg',   v: 6, pierce: 1, desc: '6 damage at range 5 — ignores block' },
  sk_blink: { id: 'sk_blink', cat: 'k', name: 'Blink',        emoji: '🌀', ap: 1, mp: 2, cd: 3, tgt: 'tile', rng: 3, fx: 'blink',          desc: 'Teleport within 3 — never provokes' },
  sk_shove: { id: 'sk_shove', cat: 'k', name: 'Shove',        emoji: '🖐️', ap: 1, mp: 2, cd: 1, tgt: 'foe',  rng: 1, fx: 'shove', v: 3,    desc: 'Push a foe 2 tiles — into walls or traps' },
  sk_whirl: { id: 'sk_whirl', cat: 'k', name: 'Whirlwind',    emoji: '🌪️', ap: 2, mp: 4, cd: 2, tgt: 'burst', rng: 1, fx: 'whirl',         desc: 'Weapon damage to every adjacent foe' },
  sk_wall:  { id: 'sk_wall',  cat: 'k', name: 'Bulwark',      emoji: '🛡️', ap: 1, mp: 3, cd: 3, tgt: 'self',         fx: 'block', v: 12,   desc: 'Gain 12 block' },
  sk_nova:  { id: 'sk_nova',  cat: 'k', name: 'Frost Nova',   emoji: '🧊', ap: 2, mp: 5, cd: 4, tgt: 'burst', rng: 2, fx: 'nova',  v: 4,    desc: '4 damage + freeze foes within 2' },
  sk_venom: { id: 'sk_venom', cat: 'k', name: 'Venom Dart',   emoji: '☠️', ap: 1, mp: 3, cd: 2, tgt: 'foe',  rng: 4, fx: 'venom', v: 3,    desc: '3 damage + poison (3 dmg × 3 turns)' },
  sk_snipe: { id: 'sk_snipe', cat: 'k', name: 'Long Shot',    emoji: '🎯', ap: 2, mp: 4, cd: 2, tgt: 'foe',  rng: 10, fx: 'dmg',  v: 8,    desc: '8 damage at range 10 — needs line of sight' },
  sk_leap:  { id: 'sk_leap',  cat: 'k', name: 'Leap',         emoji: '🦘', ap: 2, mp: 3, cd: 3, tgt: 'tile', rng: 4, fx: 'leap',           desc: 'Jump within 4; weapon damage to foes where you land' },
  sk_rtele: { id: 'sk_rtele', cat: 'k', name: 'Chaos Warp',   emoji: '🎲', ap: 1, mp: 2, cd: 4, tgt: 'self',         fx: 'rtele',          desc: 'Teleport somewhere random — no take-backs' },
  sk_vanish:{ id: 'sk_vanish',cat: 'k', name: 'Vanish',       emoji: '🫥', ap: 1, mp: 5, cd: 5, tgt: 'self',         fx: 'vanish', v: 2,   desc: 'Unseen for 2 turns — attacking reveals you' },
  sk_stalk: { id: 'sk_stalk', cat: 'k', name: 'Shadowstep',   emoji: '🥷', ap: 1, mp: 3, cd: 3, tgt: 'foe',  rng: 4, fx: 'stalk', noLos: 1, desc: 'Slip directly behind a foe — backstab from there' },
};

// Monster stats + movesets are shown to the player in the tap-to-inspect panel.
// desc: one short line of flavor/tactics (keep it under ~45 chars — phone width).
// move types: melee (adjacent), rng (ranged attack), guard (+block), rage (+atk once per fight).
// sight: how far it sees (tiles, needs line of sight) — spotting you wakes it and
// alerts it; rock and obstacles block sight, so cover is real.
// Every foe rolls a 0-4 turn sleep timer at battle start (see combat.js).
// psn: [dmg, turns] poisons the player when the hit lands.
export const MONSTERS = {
  m_rat:    { id: 'm_rat',    name: 'Giant Rat',      emoji: '🐀', hp: 13, ap: 3, def: 0, sight: 5, pool: 'easy',
    desc: 'Fast, dumb, and always hungry.',
    moves: [{ t: 'melee', name: 'Bite', emoji: '🦷', dmg: 5, ap: 2 }] },
  m_bat:    { id: 'm_bat',    name: 'Cave Bat',       emoji: '🦇', hp: 10, ap: 4, def: 0, sight: 8, pool: 'easy',
    desc: 'Frail, but too quick to outrun.',
    moves: [{ t: 'melee', name: 'Swoop', emoji: '🌬️', dmg: 4, ap: 2 }] },
  m_slime:  { id: 'm_slime',  name: 'Slime',          emoji: '🦠', hp: 18, ap: 2, def: 1, sight: 3, pool: 'easy',
    desc: 'Slow and nearly blind — easy to sneak past.',
    moves: [{ t: 'melee', name: 'Engulf', emoji: '💧', dmg: 6, ap: 2 }] },
  m_gob:    { id: 'm_gob',    name: 'Goblin',         emoji: '👺', hp: 15, ap: 3, def: 0, sight: 10, pool: 'easy',
    desc: 'Sharp-eyed sneak. Ducks behind its buckler.',
    moves: [{ t: 'melee', name: 'Shiv', emoji: '🗡️', dmg: 5, ap: 2 }, { t: 'guard', name: 'Hide', emoji: '🛡️', block: 4, ap: 1 }] },
  m_spider: { id: 'm_spider', name: 'Cave Spider',    emoji: '🕷️', hp: 11, ap: 3, def: 0, sight: 7, pool: 'easy',
    desc: 'Weak bite, but the venom lingers.',
    moves: [{ t: 'melee', name: 'Venom Bite', emoji: '☠️', dmg: 3, ap: 2, psn: [2, 2] }] },
  m_skel:   { id: 'm_skel',   name: 'Skeleton',       emoji: '💀', hp: 22, ap: 3, def: 1, sight: 10, pool: 'med',
    desc: 'An old soldier — blocks, then cuts back.',
    moves: [{ t: 'melee', name: 'Slash', emoji: '⚔️', dmg: 7, ap: 2 }, { t: 'guard', name: 'Bone Wall', emoji: '🦴', block: 6, ap: 1 }] },
  m_zomb:   { id: 'm_zomb',   name: 'Zombie',         emoji: '🧟', hp: 30, ap: 2, def: 0, sight: 4, pool: 'med',
    desc: 'Barely sees. Hits like a cart when it does.',
    moves: [{ t: 'melee', name: 'Rend', emoji: '🩸', dmg: 8, ap: 2 }] },
  m_cult:   { id: 'm_cult',   name: 'Cultist',        emoji: '🧙', hp: 18, ap: 3, def: 0, sight: 14, pool: 'med',
    desc: 'Sees far and hexes from range. Kill it first.',
    moves: [{ t: 'rng', name: 'Hex Bolt', emoji: '🔮', dmg: 6, rng: 4, ap: 2 }, { t: 'rage', name: 'Dark Chant', emoji: '💢', atk: 2, ap: 2 }] },
  m_viper:  { id: 'm_viper',  name: 'Pit Viper',      emoji: '🐍', hp: 16, ap: 4, def: 0, sight: 6, pool: 'med',
    desc: 'Quick and venomous — hard to escape.',
    moves: [{ t: 'melee', name: 'Fang', emoji: '☠️', dmg: 4, ap: 2, psn: [2, 2] }] },
  m_orc:    { id: 'm_orc',    name: 'Orc Brute',      emoji: '👹', hp: 26, ap: 3, def: 1, sight: 9, pool: 'med',
    desc: 'A wall of muscle behind a cleaver.',
    moves: [{ t: 'melee', name: 'Cleave', emoji: '🪓', dmg: 9, ap: 2 }] },
  m_ogre:   { id: 'm_ogre',   name: 'Ogre',           emoji: '🧌', hp: 38, ap: 3, def: 1, sight: 8, pool: 'elite',
    desc: 'An angry mountain. Gets madder as it fights.',
    moves: [{ t: 'melee', name: 'Smash', emoji: '💥', dmg: 11, ap: 2 }, { t: 'rage', name: 'Fury', emoji: '💢', atk: 2, ap: 1 }] },
  m_wraith: { id: 'm_wraith', name: 'Wraith',         emoji: '👻', hp: 30, ap: 4, def: 0, sight: 18, pool: 'elite',
    desc: 'Sees through the dark. Rips souls from afar.',
    moves: [{ t: 'rng', name: 'Soul Rip', emoji: '🌫️', dmg: 7, rng: 3, ap: 2 }] },
  m_golem:  { id: 'm_golem',  name: 'Stone Golem',    emoji: '🗿', hp: 44, ap: 2, def: 2, sight: 5, pool: 'elite',
    desc: 'Living rock — slow, armored, relentless.',
    moves: [{ t: 'melee', name: 'Slam', emoji: '🪨', dmg: 10, ap: 2 }, { t: 'guard', name: 'Harden', emoji: '🛡️', block: 8, ap: 1 }] },
  m_whelp:  { id: 'm_whelp',  name: 'Dragon Whelp',   emoji: '🐲', hp: 13, ap: 3, def: 0, sight: 10, pool: 'minion',
    desc: 'A dragon in miniature — bites the ankles.',
    moves: [{ t: 'melee', name: 'Nip', emoji: '🦷', dmg: 5, ap: 2 }] },
  m_dragon: { id: 'm_dragon', name: 'Ancient Dragon', emoji: '🐉', hp: 86, ap: 4, def: 2, sight: 30, pool: 'boss',
    desc: 'The Depths made flesh. It sees everything.',
    moves: [{ t: 'melee', name: 'Tail Swipe', emoji: '🌪️', dmg: 11, ap: 2 }, { t: 'rng', name: 'Fire Breath', emoji: '🔥', dmg: 8, rng: 3, ap: 2 }, { t: 'rage', name: 'Enrage', emoji: '💢', atk: 2, ap: 2 }] },
};

// Destructible cover placed by the dungeon generator. Blocks movement AND line
// of sight (shots and enemy eyes) until smashed. Shown in the inspect panel.
export const OBSTACLES = [
  { e: '🪨', hp: 10, name: 'Boulder',  desc: 'Heavy cover — blocks paths, shots, and enemy eyes until smashed.' },
  { e: '🪵', hp: 6,  name: 'Log Pile', desc: 'Stacked timber — blocks the way and hides you from view.' },
  { e: '⚱️', hp: 4,  name: 'Old Urn',  desc: 'Blocks the way. Might hold coins — smash it and see.' },
];

// What each pool drops on death. Every foe drops one piece of gear (tier ~ pool tier).
export const DROPS = {
  easy:   { gold: [3, 6],   scrap: [1, 2], tier: 1 },
  med:    { gold: [5, 9],   scrap: [1, 3], tier: 2 },
  elite:  { gold: [10, 16], scrap: [2, 4], tier: 3 },
  minion: { gold: [2, 4],   scrap: [1, 1], tier: 1 },
  boss:   { gold: [0, 0],   scrap: [0, 0], tier: 0 },
};

// Crafting: scrap (🔩) in, item/skill out. Scrap comes from breaking down gear and from drops.
export const RECIPES = [
  { out: 'w_sword',  scrap: 6 },  { out: 'w_spear', scrap: 7 },  { out: 'w_bow',   scrap: 7 },
  { out: 'w_axe',    scrap: 10 }, { out: 'w_wand',  scrap: 10 }, { out: 'w_xbow',  scrap: 13 },
  { out: 'w_hammer', scrap: 13 }, { out: 'w_flame', scrap: 17 },
  { out: 's_iron',   scrap: 7 },  { out: 's_spike', scrap: 10 }, { out: 's_tower', scrap: 13 },
  { out: 'a_chain',  scrap: 8 },  { out: 'a_plate', scrap: 12 }, { out: 'a_scale', scrap: 16 },
  { out: 'p_heal',   scrap: 7 },  { out: 'p_mana',  scrap: 5 },  { out: 'p_bomb',  scrap: 5 },  { out: 'p_tonic', scrap: 5 },
  { out: 'sk_blink', scrap: 9 },  { out: 'sk_whirl', scrap: 12 }, { out: 'sk_nova', scrap: 14 }, { out: 'sk_venom', scrap: 10 },
  { out: 'sk_snipe', scrap: 12 }, { out: 'sk_leap', scrap: 10 },  { out: 'sk_rtele', scrap: 8 }, { out: 'sk_vanish', scrap: 14 }, { out: 'sk_stalk', scrap: 12 },
];

export const NODE_EMOJI = {
  FIGHT: '⚔️', EVENT: '❓', TREASURE: '💰', SHOP: '🛒', BOSS: '🐉',
};

export function getItem(ref) {
  return WEAPONS[ref] || OFFHANDS[ref] || ARMOR[ref] || POTIONS[ref] || SKILLS[ref] || null;
}
