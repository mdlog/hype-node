// Deterministic fake series — ports `fakeSeries` from hifi-kit.jsx.

export function fakeSeries(n: number, base: number, vol: number, seed = 1): number[] {
  let s = seed;
  let v = base;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    s = (s * 9301 + 49297) % 233280;
    const r = s / 233280 - 0.5;
    v = v * (1 + r * vol);
    out.push(v);
  }
  return out;
}
