import { biomeFromClimate, getBiomeResourceCaps, getBiomeRegenRates } from './biomes.js';
import { fbm2D } from './noise.js';
import { makeDeterministicValue } from './random.js';

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function initialResourcesFromCaps(seed, x, y, caps) {
  const fill = (name) => {
    const n = makeDeterministicValue(seed, 'resourceFill', name, x, y);
    const percent = 0.6 + n * 0.4;
    return Math.round(caps[name] * percent);
  };

  return {
    food: fill('food'),
    wood: fill('wood'),
    water: fill('water'),
    materials: fill('materials'),
  };
}

function buildTile(seed, x, y, width, height) {
  const latitude = 1 - Math.abs((y / (height - 1)) * 2 - 1);

  const altitudeBase = fbm2D(`${seed}:altitude`, x, y, { baseScale: 40, octaves: 5 });
  const altitudeDetail = fbm2D(`${seed}:altitudeDetail`, x, y, { baseScale: 10, octaves: 2 });
  const altitude = clamp01(altitudeBase * 0.8 + altitudeDetail * 0.2);

  const tempNoise = fbm2D(`${seed}:temp`, x, y, { baseScale: 32, octaves: 4 });
  const temperature = clamp01(latitude * 0.7 + tempNoise * 0.3 - altitude * 0.25);

  const humidityNoise = fbm2D(`${seed}:humidity`, x, y, { baseScale: 28, octaves: 4 });
  const coastHumidityBoost = altitude < 0.35 ? 0.15 : 0;
  const humidity = clamp01(humidityNoise * 0.85 + coastHumidityBoost);

  const biome = biomeFromClimate(altitude, temperature, humidity);
  const resourceCaps = getBiomeResourceCaps(biome);
  const resources = initialResourcesFromCaps(seed, x, y, resourceCaps);

  return {
    x,
    y,
    altitude,
    temperature,
    humidity,
    biome,
    resources,
    resourceCaps,
  };
}

export function generateWorldMap({ width = 160, height = 160, seed = 'default-seed' } = {}) {
  const tiles = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      tiles.push(buildTile(seed, x, y, width, height));
    }
  }

  return {
    width,
    height,
    seed,
    tiles,
  };
}

export function regenerateWorld(world, ticks = 1) {
  const nextTiles = world.tiles.map((tile) => {
    const regen = getBiomeRegenRates(tile.biome);
    const nextResources = {
      food: Math.min(tile.resourceCaps.food, tile.resources.food + regen.food * ticks),
      wood: Math.min(tile.resourceCaps.wood, tile.resources.wood + regen.wood * ticks),
      water: Math.min(tile.resourceCaps.water, tile.resources.water + regen.water * ticks),
      materials: Math.min(tile.resourceCaps.materials, tile.resources.materials + regen.materials * ticks),
    };

    return {
      ...tile,
      resources: nextResources,
    };
  });

  return {
    ...world,
    tiles: nextTiles,
  };
}
