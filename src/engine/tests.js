import { Agent, createTraitsForTest } from './agent.js';
import { Biome } from './biomes.js';
import { createInitialSimulationState, spawnInitialAgents, tickSimulation } from './simulation.js';
import { generateWorldMap } from './world.js';

function checkResourceBounds(world) {
  for (const tile of world.tiles) {
    for (const [name, value] of Object.entries(tile.resources)) {
      if (value < 0) return { passed: false, detail: `Ressource négative (${name}) sur (${tile.x}, ${tile.y})` };
      if (value > tile.resourceCaps[name]) return { passed: false, detail: `Ressource au-dessus du cap (${name}) sur (${tile.x}, ${tile.y})` };
      if (Number.isNaN(value)) return { passed: false, detail: `Ressource NaN (${name}) sur (${tile.x}, ${tile.y})` };
    }
  }
  return { passed: true, detail: 'Toutes les ressources respectent [0, cap] et sans NaN.' };
}

function worldSignature(world) {
  let hash = 2166136261;
  for (const tile of world.tiles) {
    const line = `${tile.biome}|${tile.altitude.toFixed(3)}|${tile.temperature.toFixed(3)}|${tile.humidity.toFixed(3)}`;
    for (let i = 0; i < line.length; i += 1) {
      hash ^= line.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return hash >>> 0;
}

function checkSeedReproducibility(seed) {
  const worldA = generateWorldMap({ width: 40, height: 40, seed });
  const worldB = generateWorldMap({ width: 40, height: 40, seed });
  const worldC = generateWorldMap({ width: 40, height: 40, seed: `${seed}-different` });

  const a = worldSignature(worldA);
  const b = worldSignature(worldB);
  const c = worldSignature(worldC);

  if (a !== b) return { passed: false, detail: 'Même seed mais signatures différentes.' };
  if (a === c) return { passed: false, detail: 'Seeds différentes mais signature identique.' };
  return { passed: true, detail: 'Même seed => même monde, seed différente => monde différent.' };
}

function checkBiomeResourceCoherence(world) {
  for (const tile of world.tiles) {
    if (tile.biome === Biome.DESERT && tile.resourceCaps.water > 25) return { passed: false, detail: `Désert trop riche en eau sur (${tile.x}, ${tile.y})` };
    if (tile.biome === Biome.OCEAN && tile.resourceCaps.water < 90) return { passed: false, detail: `Océan pas assez riche en eau sur (${tile.x}, ${tile.y})` };
    if (tile.biome === Biome.FOREST && tile.resourceCaps.wood < 90) return { passed: false, detail: `Forêt pas assez riche en bois sur (${tile.x}, ${tile.y})` };
    if (tile.biome === Biome.MOUNTAIN && tile.resourceCaps.materials < 90) return { passed: false, detail: `Montagne pas assez riche en matériaux sur (${tile.x}, ${tile.y})` };
  }
  return { passed: true, detail: 'Les biomes ont des caps de ressources cohérents.' };
}

function checkPopulationAndBounds(world, agents) {
  for (const agent of agents) {
    const values = [agent.x, agent.y, agent.energy, agent.health, agent.age];
    if (values.some((v) => Number.isNaN(v))) return { passed: false, detail: `NaN détecté pour ${agent.id}.` };
    if (agent.x < 0 || agent.x >= world.width || agent.y < 0 || agent.y >= world.height) {
      return { passed: false, detail: `Agent hors carte (${agent.id}).` };
    }
  }
  return { passed: true, detail: 'Population valide, sans NaN et agents dans la carte.' };
}

function checkTraitInheritance() {
  const parentA = new Agent({
    id: 'parent-a', x: 0, y: 0, energy: 100, health: 100, age: 30,
    traits: createTraitsForTest({ curiosite: 0.2, intelligence: 0.8, agressivite: 0.4, prudence: 0.6, patience: 0.7, conscience_ecologique: 0.9 }), memory: [],
  });
  const parentB = new Agent({
    id: 'parent-b', x: 0, y: 0, energy: 100, health: 100, age: 30,
    traits: createTraitsForTest({ curiosite: 0.6, intelligence: 0.4, agressivite: 0.2, prudence: 0.8, patience: 0.3, conscience_ecologique: 0.7 }), memory: [],
  });

  const child = Agent.reproduce({ parentA, parentB, x: 0, y: 0, seed: 'inheritance-test' });
  const valid = Object.keys(child.traits).every((name) => {
    const avg = (parentA.traits[name] + parentB.traits[name]) / 2;
    return Math.abs(child.traits[name] - avg) <= 0.08;
  });

  if (!valid) return { passed: false, detail: 'Héritage des traits trop éloigné de la moyenne parentale.' };
  return { passed: true, detail: 'Héritage des traits conforme (moyenne + mutation légère).' };
}

function checkTribeRules(world, seed, agents) {
  let localWorld = world;
  let localAgents = agents;
  let state = createInitialSimulationState();
  let tribes = [];

  for (let tick = 1; tick <= 30; tick += 1) {
    const result = tickSimulation(localWorld, localAgents, tick, seed, state);
    localWorld = result.world;
    localAgents = result.agents;
    tribes = result.tribes;
    state = result.simulationState;
  }

  for (const tribe of tribes) {
    if (tribe.members.length < 2) {
      return { passed: false, detail: `Tribu invalide (${tribe.id}) avec moins de 2 membres.` };
    }
    if (tribe.stability < 0) {
      return { passed: false, detail: `Stabilité négative (${tribe.id}).` };
    }
  }

  const allMemberIds = tribes.flatMap((tribe) => tribe.members);
  const unique = new Set(allMemberIds);
  if (unique.size !== allMemberIds.length) {
    return { passed: false, detail: 'Un agent est dupliqué dans plusieurs tribus.' };
  }

  const fakeState = {
    tribes: [{ id: 'tribe-empty', members: [], sharedResources: { food: 0, wood: 0, materials: 0 }, center: { x: 0, y: 0 }, stability: 1 }],
    proximityCounters: {},
  };
  const dissolvedCheck = tickSimulation(localWorld, localAgents, 999, seed, fakeState);
  if (dissolvedCheck.tribes.some((tribe) => tribe.id === 'tribe-empty')) {
    return { passed: false, detail: 'La dissolution des tribus sans membres ne fonctionne pas.' };
  }

  return { passed: true, detail: 'Contraintes tribus respectées (taille, unicité, dissolution, stabilité).' };
}

export function runEngineTests(world, seed, agents = spawnInitialAgents(world, 30, seed)) {
  const bounds = checkResourceBounds(world);
  const reproducibility = checkSeedReproducibility(seed);
  const biomeCoherence = checkBiomeResourceCoherence(world);

  const ticked = tickSimulation(world, agents, 1, seed, createInitialSimulationState());
  const popAndBounds = checkPopulationAndBounds(ticked.world, ticked.agents);
  const inheritance = checkTraitInheritance();
  const tribes = checkTribeRules(world, seed, agents);

  return [
    { name: 'Ressources: aucune négative, aucune > cap, aucun NaN', passed: bounds.passed, detail: bounds.detail },
    { name: 'Reproductibilité par seed', passed: reproducibility.passed, detail: reproducibility.detail },
    { name: 'Cohérence biome-ressources', passed: biomeCoherence.passed, detail: biomeCoherence.detail },
    { name: 'Population agents valide et agents dans la carte', passed: popAndBounds.passed, detail: popAndBounds.detail },
    { name: 'Reproduction: héritage des traits', passed: inheritance.passed, detail: inheritance.detail },
    { name: 'Tribus: taille, unicité, dissolution, stabilité', passed: tribes.passed, detail: tribes.detail },
  ];
}
