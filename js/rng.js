// Seeded RNG (mulberry32). State is a plain object so it survives JSON save/load.
export function makeRng(seed) {
  return { s: seed >>> 0 };
}

export function rnd(r) {
  r.s = (r.s + 0x6D2B79F5) | 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const ri = (r, a, b) => a + Math.floor(rnd(r) * (b - a + 1));
export const pick = (r, arr) => arr[Math.floor(rnd(r) * arr.length)];
export const chance = (r, p) => rnd(r) < p;
