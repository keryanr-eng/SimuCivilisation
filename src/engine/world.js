import { biomeFromClimate, getBiomeResourceCaps, getBiomeRegenRates } from './biomes.js';
import { eventIntensityAt, getSeasonModifiers } from './environment.js';
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

export function regenerateWorld(world, ticks = 1, environmentState = null, activeEvents = []) {
  const season = getSeasonModifiers(environmentState?.seasonState ?? { seasonIndex: 0 });
  const tempShift = environmentState?.globalClimateState?.globalTempShift ?? 0;
  const humidityShift = environmentState?.globalClimateState?.globalHumidityShift ?? 0;

  const nextTiles = world.tiles.map((tile) => {
    const regen = getBiomeRegenRates(tile.biome);

    const drought = eventIntensityAt(activeEvents, tile.x, tile.y, 'drought');
    const flood = eventIntensityAt(activeEvents, tile.x, tile.y, 'flood');
    const wildfire = eventIntensityAt(activeEvents, tile.x, tile.y, 'wildfire');
    const coldSnap = eventIntensityAt(activeEvents, tile.x, tile.y, 'coldSnap');
    const bloom = eventIntensityAt(activeEvents, tile.x, tile.y, 'resourceBloom');

    const foodMul = Math.max(0.1, season.regenFoodMul * (1 - drought * 0.35) * (1 - wildfire * 0.45) * (1 - coldSnap * 0.3) * (1 + bloom * 0.4));
    const woodMul = Math.max(0.1, season.regenWoodMul * (1 - wildfire * 0.5) * (1 - drought * 0.2) * (1 + bloom * 0.25));
    const waterMul = Math.max(0.1, season.regenWaterMul * (1 - drought * 0.5) * (1 + flood * 0.55));
    const materialsMul = Math.max(0.1, (1 + flood * 0.15) * (1 - wildfire * 0.1));

    const adjustedCaps = {
      food: Math.max(0, tile.resourceCaps.food * (1 + humidityShift * 0.08 - tempShift * 0.06)),
      wood: Math.max(0, tile.resourceCaps.wood * (1 + humidityShift * 0.04 - tempShift * 0.04)),
      water: Math.max(0, tile.resourceCaps.water * (1 + humidityShift * 0.12 - tempShift * 0.08)),
      materials: Math.max(0, tile.resourceCaps.materials),
    };

    const nextResources = {
      food: Math.max(0, Math.min(adjustedCaps.food, tile.resources.food + regen.food * foodMul * ticks)),
      wood: Math.max(0, Math.min(adjustedCaps.wood, tile.resources.wood + regen.wood * woodMul * ticks)),
      water: Math.max(0, Math.min(adjustedCaps.water, tile.resources.water + regen.water * waterMul * ticks)),
      materials: Math.max(0, Math.min(adjustedCaps.materials, tile.resources.materials + regen.materials * materialsMul * ticks)),
    };

    return {
      ...tile,
      temperature: clamp01(tile.temperature + season.tempShift * 0.01 + tempShift * 0.01),
      humidity: clamp01(tile.humidity + season.humidityShift * 0.01 + humidityShift * 0.01),
      resources: nextResources,
      resourceCaps: adjustedCaps,
    };
  });

  return {
    ...world,
    tiles: nextTiles,
  };
}
