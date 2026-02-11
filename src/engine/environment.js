import { makeDeterministicValue } from './random.js';

const SEASONS = [
  { name: 'spring', tempShift: 0.04, humidityShift: 0.06, regenFoodMul: 1.08, regenWoodMul: 1.05, regenWaterMul: 1.04 },
  { name: 'summer', tempShift: 0.09, humidityShift: -0.04, regenFoodMul: 1.02, regenWoodMul: 0.98, regenWaterMul: 0.95 },
  { name: 'autumn', tempShift: -0.01, humidityShift: 0.02, regenFoodMul: 1.0, regenWoodMul: 1.02, regenWaterMul: 1.01 },
  { name: 'winter', tempShift: -0.1, humidityShift: -0.02, regenFoodMul: 0.86, regenWoodMul: 0.92, regenWaterMul: 0.97 },
];

const EVENT_TYPES = ['drought', 'flood', 'wildfire', 'coldSnap', 'resourceBloom'];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function createInitialEnvironmentState() {
  return {
    seasonState: { seasonIndex: 0, seasonName: 'spring', year: 0, dayInYear: 0 },
    globalClimateState: { globalTempShift: 0, globalHumidityShift: 0, driftRate: 0.0006 },
  };
}

function getSeasonState(tick, yearLength = 200) {
  const dayInYear = tick % yearLength;
  const seasonIndex = Math.floor((dayInYear / yearLength) * 4) % 4;
  return {
    seasonIndex,
    seasonName: SEASONS[seasonIndex].name,
    year: Math.floor(tick / yearLength),
    dayInYear,
  };
}

function createEvent({ tick, seed, width, height, index }) {
  const typeRoll = makeDeterministicValue(seed, 'env-event-type', tick, index);
  const type = EVENT_TYPES[Math.floor(typeRoll * EVENT_TYPES.length) % EVENT_TYPES.length];
  const x = Math.floor(makeDeterministicValue(seed, 'env-event-x', tick, index) * width);
  const y = Math.floor(makeDeterministicValue(seed, 'env-event-y', tick, index) * height);
  const radius = 5 + Math.floor(makeDeterministicValue(seed, 'env-event-r', tick, index) * 9);
  const intensity = clamp(0.25 + makeDeterministicValue(seed, 'env-event-i', tick, index) * 0.65, 0.2, 1);
  const durationTicks = 25 + Math.floor(makeDeterministicValue(seed, 'env-event-d', tick, index) * 70);
  return {
    id: `${type}-${tick}-${index}`,
    type,
    x,
    y,
    radius,
    intensity,
    durationTicks,
    remainingTicks: durationTicks,
    startedAtTick: tick,
  };
}

function shouldSpawnEvent(tick, seed) {
  if (tick % 25 !== 0) return false;
  const p = makeDeterministicValue(seed, 'env-event-prob', tick);
  return p < 0.08;
}

export function getSeasonModifiers(seasonState) {
  return SEASONS[seasonState.seasonIndex] ?? SEASONS[0];
}

export function advanceEnvironment({ environmentState, activeEvents, tick, seed, width, height }) {
  const previous = environmentState ?? createInitialEnvironmentState();
  const seasonState = getSeasonState(tick, 200);

  const climate = { ...previous.globalClimateState };
  const driftTemp = (makeDeterministicValue(seed, 'drift-temp', tick) - 0.5) * climate.driftRate;
  const driftHum = (makeDeterministicValue(seed, 'drift-hum', tick) - 0.5) * climate.driftRate;
  climate.globalTempShift = clamp(climate.globalTempShift + driftTemp, -0.35, 0.35);
  climate.globalHumidityShift = clamp(climate.globalHumidityShift + driftHum, -0.35, 0.35);

  const nextEvents = (activeEvents ?? [])
    .map((event) => ({ ...event, remainingTicks: event.remainingTicks - 1 }))
    .filter((event) => event.remainingTicks > 0);

  if (shouldSpawnEvent(tick, seed)) {
    nextEvents.push(createEvent({ tick, seed, width, height, index: nextEvents.length + 1 }));
  }

  return {
    environmentState: {
      seasonState,
      globalClimateState: climate,
    },
    activeEvents: nextEvents,
  };
}

export function eventIntensityAt(activeEvents, x, y, type) {
  let sum = 0;
  (activeEvents ?? []).forEach((event) => {
    if (type && event.type !== type) return;
    const dx = event.x - x;
    const dy = event.y - y;
    const dist = Math.hypot(dx, dy);
    if (dist <= event.radius) {
      sum += event.intensity * (1 - dist / Math.max(1, event.radius));
    }
  });
  return clamp(sum, 0, 2);
}
