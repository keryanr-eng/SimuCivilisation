import { Agent } from './agent.js';
import { Tribe } from './tribe.js';

function sanitizeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function sanitizeObjectNumbers(obj) {
  const next = {};
  Object.entries(obj ?? {}).forEach(([key, value]) => {
    next[key] = typeof value === 'number' ? sanitizeNumber(value, 0) : value;
  });
  return next;
}

export function serializeWorld(world) {
  return JSON.stringify({
    width: world.width,
    height: world.height,
    seed: world.seed,
    tiles: world.tiles.map((tile) => ({
      ...tile,
      altitude: sanitizeNumber(tile.altitude, 0),
      temperature: sanitizeNumber(tile.temperature, 0),
      humidity: sanitizeNumber(tile.humidity, 0),
      resources: sanitizeObjectNumbers(tile.resources),
      resourceCaps: sanitizeObjectNumbers(tile.resourceCaps),
    })),
  });
}

export function deserializeWorld(json) {
  const parsed = typeof json === 'string' ? JSON.parse(json) : json;
  return {
    width: parsed.width,
    height: parsed.height,
    seed: parsed.seed,
    tiles: (parsed.tiles ?? []).map((tile) => ({
      ...tile,
      resources: sanitizeObjectNumbers(tile.resources),
      resourceCaps: sanitizeObjectNumbers(tile.resourceCaps),
    })),
  };
}

export function serializeAgents(agents) {
  return JSON.stringify(agents.map((agent) => ({ ...agent.toSerializable() })));
}

export function deserializeAgents(json) {
  const parsed = typeof json === 'string' ? JSON.parse(json) : json;
  return (parsed ?? []).map((item) => new Agent(item));
}

export function serializeSimulationState(state) {
  return JSON.stringify({
    tribes: (state.tribes ?? []).map((tribe) => (tribe.toSerializable ? tribe.toSerializable() : tribe)),
    proximityCounters: { ...(state.proximityCounters ?? {}) },
    interactionMemory: { ...(state.interactionMemory ?? {}) },
    environmentState: state.environmentState ?? null,
    activeEvents: state.activeEvents ?? [],
  });
}

export function deserializeSimulationState(json) {
  const parsed = typeof json === 'string' ? JSON.parse(json) : json;
  return {
    tribes: (parsed.tribes ?? []).map((tribe) => new Tribe(tribe)),
    proximityCounters: { ...(parsed.proximityCounters ?? {}) },
    interactionMemory: { ...(parsed.interactionMemory ?? {}) },
    environmentState: parsed.environmentState ?? null,
    activeEvents: parsed.activeEvents ?? [],
  };
}

export function serializeAll({ world, agents, state, tick, seed }) {
  return JSON.stringify({
    version: 1,
    seed,
    tick: sanitizeNumber(tick, 0),
    world: JSON.parse(serializeWorld(world)),
    agents: JSON.parse(serializeAgents(agents)),
    state: JSON.parse(serializeSimulationState(state)),
    savedAt: Date.now(),
  });
}

export function deserializeAll(json) {
  const parsed = typeof json === 'string' ? JSON.parse(json) : json;
  return {
    seed: parsed.seed,
    tick: sanitizeNumber(parsed.tick, 0),
    world: deserializeWorld(parsed.world),
    agents: deserializeAgents(parsed.agents),
    state: deserializeSimulationState(parsed.state),
  };
}
