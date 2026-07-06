// All game content lives here. Tune numbers, add monsters/gear/potions freely —
// the rest of the code is data-driven off these tables.

export const WEAPONS = {
  w_dagger: { id: 'w_dagger', cat: 'w', name: 'Dagger',      emoji: '🗡️', atk: 2, tier: 1, price: 20 },
  w_club:   { id: 'w_club',   cat: 'w', name: 'Club',        emoji: '🏏', atk: 3, tier: 1, price: 24 },
  w_sword:  { id: 'w_sword',  cat: 'w', name: 'Sword',       emoji: '⚔️', atk: 4, tier: 2, price: 30 },
  w_axe:    { id: 'w_axe',    cat: 'w', name: 'Battle Axe',  emoji: '🪓', atk: 6, tier: 3, price: 38 },
  w_hammer: { id: 'w_hammer', cat: 'w', name: 'Warhammer',   emoji: '🔨', atk: 7, tier: 4, price: 44 },
  w_flame:  { id: 'w_flame',  cat: 'w', name: 'Flame Blade', emoji: '🔥', atk: 9, tier: 5, price: 55 },
};

export const ARMOR = {
  a_leather: { id: 'a_leather', cat: 'a', name: 'Leather Armor', emoji: '🥋', def: 1, tier: 1, price: 22 },
  a_chain:   { id: 'a_chain',   cat: 'a', name: 'Chainmail',     emoji: '⛓️', def: 2, tier: 2, price: 32 },
  a_plate:   { id: 'a_plate',   cat: 'a', name: 'Knight Plate',  emoji: '🛡️', def: 3, tier: 3, price: 42 },
  a_scale:   { id: 'a_scale',   cat: 'a', name: 'Dragon Scale',  emoji: '🐲', def: 4, tier: 4, price: 55 },
};

// w = drop weight (relative rarity)
export const POTIONS = {
  p_heal:   { id: 'p_heal',   cat: 'p', name: 'Healing Potion',  emoji: '🧪', desc: 'Restore 18 HP',                 price: 24, w: 35 },
  p_bomb:   { id: 'p_bomb',   cat: 'p', name: 'Fire Bomb',       emoji: '💣', desc: 'Deal 15 damage, ignores block', price: 26, w: 25 },
  p_str:    { id: 'p_str',    cat: 'p', name: 'Strength Elixir', emoji: '⚗️', desc: '+3 Attack for this combat',     price: 28, w: 18 },
  p_shield: { id: 'p_shield', cat: 'p', name: 'Barrier Tonic',   emoji: '🧿', desc: 'Gain 12 Block',                 price: 26, w: 14 },
  p_life:   { id: 'p_life',   cat: 'p', name: 'Elixir of Life',  emoji: '❤️', desc: '+8 Max HP permanently',         price: 40, w: 8 },
};

// pattern moves: {t:'a'} attack (m = damage multiplier), {t:'d',b:N} gain block, {t:'b',a:N} gain attack
export const MONSTERS = {
  m_rat:    { name: 'Giant Rat',      emoji: '🐀', hp: 14, atk: 4,  pool: 'easy',  pattern: [{ t: 'a' }, { t: 'a' }] },
  m_bat:    { name: 'Cave Bat',       emoji: '🦇', hp: 12, atk: 5,  pool: 'easy',  pattern: [{ t: 'a' }, { t: 'a' }, { t: 'd', b: 5 }] },
  m_slime:  { name: 'Slime',          emoji: '🦠', hp: 18, atk: 3,  pool: 'easy',  pattern: [{ t: 'a' }, { t: 'd', b: 5 }, { t: 'a' }] },
  m_goblin: { name: 'Goblin',         emoji: '👺', hp: 20, atk: 5,  pool: 'easy',  pattern: [{ t: 'a' }, { t: 'a' }, { t: 'b', a: 1 }] },
  m_snake:  { name: 'Pit Viper',      emoji: '🐍', hp: 22, atk: 7,  pool: 'med',   pattern: [{ t: 'a' }, { t: 'd', b: 5 }] },
  m_skel:   { name: 'Skeleton',       emoji: '💀', hp: 26, atk: 7,  pool: 'med',   pattern: [{ t: 'a' }, { t: 'd', b: 6 }, { t: 'a' }] },
  m_cult:   { name: 'Cultist',        emoji: '🧙', hp: 24, atk: 6,  pool: 'med',   pattern: [{ t: 'b', a: 2 }, { t: 'a' }, { t: 'a' }] },
  m_orc:    { name: 'Orc Brute',      emoji: '👹', hp: 30, atk: 8,  pool: 'med',   pattern: [{ t: 'a' }, { t: 'a' }, { t: 'd', b: 8 }] },
  m_ogre:   { name: 'Ogre',           emoji: '🧌', hp: 44, atk: 9,  pool: 'elite', pattern: [{ t: 'a' }, { t: 'b', a: 2 }, { t: 'a' }, { t: 'a' }] },
  m_wraith: { name: 'Wraith',         emoji: '👻', hp: 40, atk: 8,  pool: 'elite', pattern: [{ t: 'd', b: 10 }, { t: 'a' }, { t: 'a' }, { t: 'b', a: 2 }] },
  m_dragon: { name: 'Ancient Dragon', emoji: '🐉', hp: 62, atk: 9,  pool: 'boss',  pattern: [{ t: 'b', a: 2 }, { t: 'a' }, { t: 'a' }, { t: 'a', m: 2 }] },
};

export const NODE_EMOJI = {
  FIGHT: '⚔️', ELITE: '☠️', TREASURE: '💰', REST: '⛺', SHOP: '🛒', BOSS: '🐉',
};

export function getItem(ref) {
  return WEAPONS[ref] || ARMOR[ref] || POTIONS[ref] || null;
}
