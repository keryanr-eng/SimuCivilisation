import { Agent, createTraitsForTest } from './agent.js';
import { createBelief, diffuseBelief, updateBeliefsLifecycle } from './beliefs.js';
import { Biome } from './biomes.js';
import {
  createInteractionMemoryRecord,
  decideTribeAction,
  resolveInteraction,
  updateInteractionMemory,
} from './interactions.js';
import { runExperiments } from './experiments.js';
import { deserializeAll, serializeAll } from './serialize.js';
import {
  applyStorageCap,
  collectTechnologyEffects,
  computeTechProgressRate,
  updateTribeTechnology,
} from './technology.js';
import {
  computeHarvestYield,
  computeMovementSteps,
  createInitialSimulationState,
  spawnInitialAgents,
  tickSimulation,
} from './simulation.js';
import { TRIBE_CULTURE_KEYS, Tribe } from './tribe.js';
import { generateWorldMap } from './world.js';

function checkResourceBounds(world) {
  for (const tile of world.tiles) {
    for (const [name, value] of Object.entries(tile.resources)) {
      if (value < 0 || Number.isNaN(value)) return { passed: false, detail: `Ressource invalide (${name})` };
      if (value > tile.resourceCaps[name] + 1e-6) return { passed: false, detail: `Ressource au-dessus du cap (${name})` };
    }
  }
  return { passed: true, detail: 'Ressources bornées et sans NaN.' };
}

function checkSeedReproducibility(seed) {
  const a = generateWorldMap({ width: 30, height: 30, seed });
  const b = generateWorldMap({ width: 30, height: 30, seed });
  if (a.tiles[42].biome !== b.tiles[42].biome) return { passed: false, detail: 'Seed non reproductible.' };
  return { passed: true, detail: 'Seed reproductible.' };
}

function checkBiomeResourceCoherence(world) {
  for (const tile of world.tiles) {
    if (tile.biome === Biome.DESERT && tile.resourceCaps.water > 25) return { passed: false, detail: 'Désert eau incohérent.' };
    if (tile.biome === Biome.OCEAN && tile.resourceCaps.water < 90) return { passed: false, detail: 'Océan eau incohérent.' };
  }
  return { passed: true, detail: 'Cohérence biome/ressources OK.' };
}

function checkPopulationAndBounds(world, agents) {
  for (const agent of agents) {
    if ([agent.x, agent.y, agent.energy, agent.health, agent.age].some(Number.isNaN)) return { passed: false, detail: 'NaN agent.' };
    if (agent.x < 0 || agent.x >= world.width || agent.y < 0 || agent.y >= world.height) return { passed: false, detail: 'Agent hors carte.' };
  }
  return { passed: true, detail: 'Population et bornes OK.' };
}

function checkTraitInheritance() {
  const a = new Agent({ id: 'a', x: 0, y: 0, traits: createTraitsForTest({ intelligence: 0.8 }), memory: [] });
  const b = new Agent({ id: 'b', x: 0, y: 0, traits: createTraitsForTest({ intelligence: 0.2 }), memory: [] });
  const child = Agent.reproduce({ parentA: a, parentB: b, x: 0, y: 0, seed: 't' });
  if (Number.isNaN(child.traits.intelligence)) return { passed: false, detail: 'Héritage NaN.' };
  return { passed: true, detail: 'Héritage traits OK.' };
}

function checkTribeAndEnvironmentStability(world, seed, agents) {
  let localWorld = world;
  let localAgents = agents;
  let state = createInitialSimulationState();
  for (let t = 1; t <= 1000; t += 1) {
    const out = tickSimulation(localWorld, localAgents, t, seed, state);
    localWorld = out.world;
    localAgents = out.agents;
    state = out.simulationState;

    if (out.world.tiles.some((tile) => Object.values(tile.resources).some((v) => v < 0 || Number.isNaN(v)))) {
      return { passed: false, detail: 'Ressources négatives/NaN pendant 1000 ticks.' };
    }
    const climate = state.environmentState?.globalClimateState;
    if (!climate || Math.abs(climate.globalTempShift) > 0.36 || Math.abs(climate.globalHumidityShift) > 0.36) {
      return { passed: false, detail: 'Climat hors bornes.' };
    }
  }

  let eventState = createInitialSimulationState();
  let w = world;
  let a = agents;
  for (let t = 1; t <= 260; t += 1) {
    const out = tickSimulation(w, a, t, seed, eventState);
    w = out.world;
    a = out.agents;
    eventState = out.simulationState;
  }
  if ((eventState.activeEvents ?? []).some((e) => e.remainingTicks <= 0)) return { passed: false, detail: 'Events expirés non nettoyés.' };

  return { passed: true, detail: 'Stabilité environnementale OK (1000 ticks).' };
}

function checkInteractions() {
  const ta = new Tribe({ id: 'ta', members: ['a', 'b'], sharedResources: { food: 30, wood: 5, materials: 5 }, center: { x: 0, y: 0 }, stability: 1, culture: { tech: 0.4, war: 0.2, education: 0.7, trade: 0.8, ecology: 0.6, spirituality: 0.5 } });
  const tb = new Tribe({ id: 'tb', members: ['c', 'd'], sharedResources: { food: 30, wood: 5, materials: 5 }, center: { x: 1, y: 1 }, stability: 1, culture: { tech: 0.4, war: 0.2, education: 0.7, trade: 0.8, ecology: 0.6, spirituality: 0.5 } });
  const low = createInteractionMemoryRecord({ trustScore: -0.9, lastActions: { a: 'attack', b: 'attack' } });
  const high = createInteractionMemoryRecord({ trustScore: 0.9, lastActions: { a: 'trade', b: 'trade' } });
  const a1 = decideTribeAction(ta, tb, { tick: 1, recentConflict: true }, low, 0.5);
  const a2 = decideTribeAction(ta, tb, { tick: 1, recentConflict: false }, high, 0.5);
  if (a1 === a2) return { passed: false, detail: 'Mémoire n’influence pas interaction.' };
  const m = updateInteractionMemory(low, 'trade', 'trade', 0.2, 2);
  if (m.trustScore < -1 || m.trustScore > 1) return { passed: false, detail: 'Trust hors bornes.' };
  const out = resolveInteraction(ta, tb, 'attack', 'attack', null, 0.4);
  if ([out.deadA, out.deadB, ta.sharedResources.food, tb.sharedResources.food].some(Number.isNaN)) return { passed: false, detail: 'NaN interactions.' };
  return { passed: true, detail: 'Interactions OK.' };
}

function checkBeliefs() {
  const a = new Tribe({ id: 'a', members: ['a1', 'a2'], sharedResources: { food: 20, wood: 5, materials: 4 }, center: { x: 0, y: 0 }, stability: 1, culture: { tech: 0.5, war: 0.2, education: 0.5, trade: 0.5, ecology: 0.5, spirituality: 0.8 }, beliefs: [createBelief({ id: 'b1', type: 'trade', trigger: 'trader_path', effect: { trustGainBonus: 0.04 }, strength: 0.08, age: 0 })] });
  const b = new Tribe({ id: 'b', members: ['b1', 'b2'], sharedResources: { food: 20, wood: 5, materials: 4 }, center: { x: 1, y: 1 }, stability: 1, culture: { tech: 0.5, war: 0.2, education: 0.5, trade: 0.5, ecology: 0.5, spirituality: 0.7 }, beliefs: [] });
  diffuseBelief(a, b, 1, 0.01);
  if (b.beliefs.length === 0) return { passed: false, detail: 'Diffusion croyance KO.' };
  a.beliefs = [createBelief({ id: 'w', type: 'survival', trigger: 'famine', effect: {}, strength: 0.061, age: 0 })];
  updateBeliefsLifecycle(a, -1);
  if (a.beliefs.length !== 0) return { passed: false, detail: 'Disparition croyance KO.' };
  return { passed: true, detail: 'Croyances OK.' };
}

function checkTechnology() {
  const tribe = new Tribe({ id: 't', members: ['a', 'b', 'c', 'd'], sharedResources: { food: 140, wood: 20, materials: 20 }, center: { x: 0, y: 0 }, stability: 1.4, culture: { tech: 0.9, war: 0.2, education: 0.8, trade: 0.6, ecology: 0.5, spirituality: 0.4 } });
  if (!(computeTechProgressRate({ tribe, surplus: 60, positiveInteractions: 2 }) > 0)) return { passed: false, detail: 'Progress rate KO.' };
  for (let i = 0; i < 80; i += 1) updateTribeTechnology(tribe, { surplus: 60, positiveInteractions: 2 });
  if (tribe.globalTechLevel < 1) return { passed: false, detail: 'Level up KO.' };
  const effects = collectTechnologyEffects(tribe);
  if (Object.values(effects).some((v) => Number.isNaN(v) || v < 0 || v > 0.5)) return { passed: false, detail: 'Effects hors bornes.' };
  if (!(computeHarvestYield({ availableFood: 30, intelligence: 0.7, efficiencyBonus: effects.efficiencyBonus }) >= computeHarvestYield({ availableFood: 30, intelligence: 0.7, efficiencyBonus: 0 }))) {
    return { passed: false, detail: 'Bonus récolte KO.' };
  }
  if (!(computeMovementSteps(effects.movementBonus) >= computeMovementSteps(0))) return { passed: false, detail: 'Bonus mouvement KO.' };
  if (!(applyStorageCap(220, effects.storageBonus) >= 220)) return { passed: false, detail: 'Bonus stockage KO.' };
  return { passed: true, detail: 'Technologie OK.' };
}

function checkSerialization(world, seed, agents) {
  const state = createInitialSimulationState();
  const packed = serializeAll({ world, agents, state, tick: 12, seed });
  const unpacked = deserializeAll(packed);
  if (unpacked.world.width !== world.width || unpacked.agents.length !== agents.length || unpacked.tick !== 12 || unpacked.seed !== seed) {
    return { passed: false, detail: 'Serialize/deserialize invariants KO.' };
  }
  const resumed = tickSimulation(unpacked.world, unpacked.agents, unpacked.tick + 1, unpacked.seed, unpacked.state);
  if (resumed.agents.some((agent) => [agent.x, agent.y, agent.energy].some(Number.isNaN))) return { passed: false, detail: 'NaN après load snapshot.' };
  return { passed: true, detail: 'Serialize/deserialize/reprise OK.' };
}

function checkExperiments() {
  const out = runExperiments({ runs: 10, ticksPerRun: 30, worldSize: 80, baseSeed: 'phase9-test' });
  if ((out.records ?? []).length !== 10) return { passed: false, detail: 'Multi-run KO.' };
  if ([out.summary.population.mean, out.summary.tribes.mean, out.summary.tech.mean].some(Number.isNaN)) return { passed: false, detail: 'NaN multi-run.' };
  return { passed: true, detail: 'Multi-run stable 10 runs.' };
}

export function runEngineTests(world, seed, agents = spawnInitialAgents(world, 30, seed)) {
  const bounds = checkResourceBounds(world);
  const reproducibility = checkSeedReproducibility(seed);
  const biomeCoherence = checkBiomeResourceCoherence(world);
  const ticked = tickSimulation(world, agents, 1, seed, createInitialSimulationState());
  const popAndBounds = checkPopulationAndBounds(ticked.world, ticked.agents);
  const inheritance = checkTraitInheritance();
  const tribeEnv = checkTribeAndEnvironmentStability(world, seed, agents);
  const interactions = checkInteractions();
  const beliefs = checkBeliefs();
  const technology = checkTechnology();
  const serialization = checkSerialization(world, seed, agents);
  const experiments = checkExperiments();

  return [
    { name: 'Ressources bornées et sans NaN', passed: bounds.passed, detail: bounds.detail },
    { name: 'Reproductibilité par seed', passed: reproducibility.passed, detail: reproducibility.detail },
    { name: 'Cohérence biome-ressources', passed: biomeCoherence.passed, detail: biomeCoherence.detail },
    { name: 'Population agents valide et bornes carte', passed: popAndBounds.passed, detail: popAndBounds.detail },
    { name: 'Reproduction: héritage des traits', passed: inheritance.passed, detail: inheritance.detail },
    { name: 'Environnement: saisons/events/climat stables (1000 ticks)', passed: tribeEnv.passed, detail: tribeEnv.detail },
    { name: 'Interactions: trust, mémoire, ressources', passed: interactions.passed, detail: interactions.detail },
    { name: 'Croyances: diffusion + disparition', passed: beliefs.passed, detail: beliefs.detail },
    { name: 'Technologie: progression + effets + bornes', passed: technology.passed, detail: technology.detail },
    { name: 'Serialization: save/load/reprise', passed: serialization.passed, detail: serialization.detail },
    { name: 'Experiments: multi-run stable', passed: experiments.passed, detail: experiments.detail },
  ];
}
