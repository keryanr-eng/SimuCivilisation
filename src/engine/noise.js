import { makeDeterministicValue } from './random.js';

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothStep(t) {
  return t * t * (3 - 2 * t);
}

export function valueNoise2D(seed, x, y, scale = 16) {
  const gx = x / scale;
  const gy = y / scale;

  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  const sx = smoothStep(gx - x0);
  const sy = smoothStep(gy - y0);

  const n00 = makeDeterministicValue(seed, x0, y0);
  const n10 = makeDeterministicValue(seed, x1, y0);
  const n01 = makeDeterministicValue(seed, x0, y1);
  const n11 = makeDeterministicValue(seed, x1, y1);

  const ix0 = lerp(n00, n10, sx);
  const ix1 = lerp(n01, n11, sx);

  return lerp(ix0, ix1, sy);
}

export function fbm2D(seed, x, y, options = {}) {
  const octaves = options.octaves ?? 4;
  const persistence = options.persistence ?? 0.5;
  const lacunarity = options.lacunarity ?? 2;
  const baseScale = options.baseScale ?? 24;

  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;

  for (let i = 0; i < octaves; i += 1) {
    const n = valueNoise2D(`${seed}:o${i}`, x * frequency, y * frequency, baseScale);
    sum += n * amplitude;
    norm += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return sum / norm;
}
