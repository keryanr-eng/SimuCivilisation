export const Biome = Object.freeze({
  OCEAN: 'ocean',
  PLAINS: 'plains',
  FOREST: 'forest',
  DESERT: 'desert',
  MOUNTAIN: 'mountain',
  TAIGA: 'taiga',
});

export const BIOME_COLORS = Object.freeze({
  [Biome.OCEAN]: '#2b5fd9',
  [Biome.PLAINS]: '#7dbf57',
  [Biome.FOREST]: '#2f8f45',
  [Biome.DESERT]: '#d9c46b',
  [Biome.MOUNTAIN]: '#8a8f98',
  [Biome.TAIGA]: '#4f7f8c',
});

const BASE_CAPS = Object.freeze({
  [Biome.OCEAN]: { food: 60, wood: 0, water: 100, materials: 10 },
  [Biome.PLAINS]: { food: 100, wood: 40, water: 60, materials: 50 },
  [Biome.FOREST]: { food: 80, wood: 100, water: 70, materials: 40 },
  [Biome.DESERT]: { food: 25, wood: 10, water: 20, materials: 70 },
  [Biome.MOUNTAIN]: { food: 20, wood: 15, water: 45, materials: 100 },
  [Biome.TAIGA]: { food: 50, wood: 75, water: 65, materials: 60 },
});

const REGEN_RATES = Object.freeze({
  [Biome.OCEAN]: { food: 0.8, wood: 0, water: 1.2, materials: 0.2 },
  [Biome.PLAINS]: { food: 1, wood: 0.3, water: 0.5, materials: 0.3 },
  [Biome.FOREST]: { food: 0.6, wood: 1.2, water: 0.5, materials: 0.2 },
  [Biome.DESERT]: { food: 0.1, wood: 0.05, water: 0.1, materials: 0.5 },
  [Biome.MOUNTAIN]: { food: 0.1, wood: 0.1, water: 0.2, materials: 1 },
  [Biome.TAIGA]: { food: 0.4, wood: 0.9, water: 0.4, materials: 0.5 },
});

export function biomeFromClimate(altitude, temperature, humidity) {
  if (altitude < 0.28) return Biome.OCEAN;
  if (altitude > 0.82) return Biome.MOUNTAIN;
  if (temperature > 0.72 && humidity < 0.35) return Biome.DESERT;
  if (temperature < 0.28 && humidity >= 0.45) return Biome.TAIGA;
  if (humidity > 0.68) return Biome.FOREST;
  return Biome.PLAINS;
}

export function getBiomeResourceCaps(biome) {
  return { ...BASE_CAPS[biome] };
}

export function getBiomeRegenRates(biome) {
  return { ...REGEN_RATES[biome] };
}
