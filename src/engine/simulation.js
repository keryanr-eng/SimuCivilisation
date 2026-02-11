import { Agent } from './agent.js';
import { makeDeterministicValue } from './random.js';
import { Tribe } from './tribe.js';

const NEAR_DISTANCE = 2;
const SHARE_DISTANCE = 1;
const TRIBE_FORMATION_TICKS = 6;
const MAX_TRIBE_SPREAD = 8;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function pairKey(idA, idB) {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

function tileIndex(world, x, y) {
  return y * world.width + x;
}

function moveAgent(agent, world, tick, seed) {
  const moveSeed = `${seed}|move|${agent.id}|${tick}`;
  const driftX = Math.floor(makeDeterministicValue(moveSeed, 'dx') * 3) - 1;
  const driftY = Math.floor(makeDeterministicValue(moveSeed, 'dy') * 3) - 1;
  const cautiousBias = agent.traits.prudence > 0.7 ? 0 : 1;
  const dx = driftX * cautiousBias;
  const dy = driftY * cautiousBias;

  agent.x = clamp(agent.x + dx, 0, world.width - 1);
  agent.y = clamp(agent.y + dy, 0, world.height - 1);
}

function harvestFood(agent, tile, tribe) {
  const harvestPower = 1.5 + agent.traits.intelligence * 2;
  const available = tile.resources.food;
  const taken = Math.min(available, harvestPower);
  tile.resources.food -= taken;

  if (tribe) {
    const contribution = taken * 0.35;
    tribe.sharedResources.food += contribution;
    agent.energy = Math.min(120, agent.energy + (taken - contribution) * 1.8);
  } else {
    agent.energy = Math.min(120, agent.energy + taken * 1.8);
  }

  if (taken > 0) {
    agent.remember(`harvest:${taken.toFixed(2)}`);
  }
}

function applyLifeCosts(agent) {
  const ageCost = Math.min(0.8, agent.age * 0.001);
  agent.energy -= 1 + ageCost;
  agent.age += 1;

  if (agent.energy <= 0) {
    agent.isAlive = false;
    agent.energy = 0;
    agent.health = 0;
    agent.remember('dead:energy');
  }
}

function maybeReproduce(agent, agents, newborns, world, tick, seed) {
  if (!agent.isAlive || agent.energy < 95 || agent.age < 20) return;

  const roll = makeDeterministicValue(`${seed}|repro|${agent.id}|${tick}`, 'chance');
  const chance = 0.02 + agent.traits.patience * 0.02;
  if (roll > chance) return;

  const partner = agents.find((candidate) =>
    candidate.id !== agent.id &&
    candidate.isAlive &&
    candidate.energy >= 85 &&
    candidate.age >= 20 &&
    Math.abs(candidate.x - agent.x) <= 1 &&
    Math.abs(candidate.y - agent.y) <= 1,
  );

  if (!partner) return;

  const childX = clamp(agent.x + (Math.floor(makeDeterministicValue(seed, tick, agent.id, 'cx') * 3) - 1), 0, world.width - 1);
  const childY = clamp(agent.y + (Math.floor(makeDeterministicValue(seed, tick, agent.id, 'cy') * 3) - 1), 0, world.height - 1);

  const child = Agent.reproduce({
    parentA: agent,
    parentB: partner,
    x: childX,
    y: childY,
    seed: `${seed}|child|${agent.id}|${partner.id}|${tick}`,
  });

  agent.energy -= 25;
  partner.energy -= 20;
  agent.remember(`reproduce:${child.id}`);
  partner.remember(`reproduce:${child.id}`);
  newborns.push(child);
}

function updateProximityCounters(agents, previousCounters) {
  const counters = { ...previousCounters };
  const aliveAgents = agents.filter((agent) => agent.isAlive);

  for (let i = 0; i < aliveAgents.length; i += 1) {
    for (let j = i + 1; j < aliveAgents.length; j += 1) {
      const a = aliveAgents[i];
      const b = aliveAgents[j];
      const key = pairKey(a.id, b.id);
      if (distance(a, b) <= NEAR_DISTANCE) {
        counters[key] = (counters[key] ?? 0) + 1;
      } else {
        delete counters[key];
      }
    }
  }

  Object.keys(counters).forEach((key) => {
    const [idA, idB] = key.split('|');
    if (!aliveAgents.some((agent) => agent.id === idA) || !aliveAgents.some((agent) => agent.id === idB)) {
      delete counters[key];
    }
  });

  return counters;
}

function performLocalSharing(agents, counters) {
  const exchanges = new Set();
  const aliveAgents = agents.filter((agent) => agent.isAlive);

  for (let i = 0; i < aliveAgents.length; i += 1) {
    for (let j = i + 1; j < aliveAgents.length; j += 1) {
      const a = aliveAgents[i];
      const b = aliveAgents[j];
      const key = pairKey(a.id, b.id);
      if ((counters[key] ?? 0) < 2) continue;
      if (distance(a, b) > SHARE_DISTANCE) continue;

      const donor = a.energy > b.energy ? a : b;
      const receiver = donor === a ? b : a;
      if (donor.energy - receiver.energy > 14 && donor.energy > 55) {
        donor.energy -= 3;
        receiver.energy += 3;
        exchanges.add(key);
      }
    }
  }

  return exchanges;
}

function createTribesFromCooperation(agents, existingTribes, counters, exchangeSet) {
  const tribes = existingTribes.map((tribe) => new Tribe(tribe.toSerializable()));
  const memberToTribe = new Map();

  tribes.forEach((tribe) => {
    tribe.members.forEach((memberId) => {
      if (!memberToTribe.has(memberId)) {
        memberToTribe.set(memberId, tribe.id);
      }
    });
  });

  Object.keys(counters).forEach((key) => {
    if ((counters[key] ?? 0) < TRIBE_FORMATION_TICKS) return;
    if (!exchangeSet.has(key)) return;

    const [idA, idB] = key.split('|');
    if (memberToTribe.has(idA) || memberToTribe.has(idB)) return;

    const tribe = new Tribe({
      members: [idA, idB],
      sharedResources: { food: 8, wood: 0, materials: 0 },
      stability: 1,
    });

    tribe.members.forEach((memberId) => memberToTribe.set(memberId, tribe.id));
    tribes.push(tribe);
  });

  return { tribes, memberToTribe };
}

function updateTribesAfterAgentChanges(agents, tribes, memberToTribe) {
  const aliveMap = new Map(agents.filter((agent) => agent.isAlive).map((agent) => [agent.id, agent]));
  const nextTribes = [];
  let dissolvedCount = 0;

  tribes.forEach((tribe) => {
    tribe.members = tribe.members.filter((memberId) => aliveMap.has(memberId));
    tribe.refreshCenter(aliveMap);

    tribe.members = tribe.members.filter((memberId) => {
      const agent = aliveMap.get(memberId);
      if (!agent) return false;
      const spread = Math.max(Math.abs(agent.x - tribe.center.x), Math.abs(agent.y - tribe.center.y));
      return spread <= MAX_TRIBE_SPREAD;
    });

    if (tribe.members.length < 2) {
      dissolvedCount += 1;
      tribe.members.forEach((memberId) => memberToTribe.delete(memberId));
      return;
    }

    tribe.refreshCenter(aliveMap);
    nextTribes.push(tribe);
  });

  nextTribes.forEach((tribe) => {
    tribe.members.forEach((memberId) => memberToTribe.set(memberId, tribe.id));
  });

  return { nextTribes, dissolvedCount };
}

function tribeSupportMembers(agents, tribes, memberToTribe, deathsThisTick) {
  const agentMap = new Map(agents.map((agent) => [agent.id, agent]));

  tribes.forEach((tribe) => {
    let helped = 0;
    tribe.members.forEach((memberId) => {
      const agent = agentMap.get(memberId);
      if (!agent || !agent.isAlive) return;
      if (agent.energy < 30 && tribe.sharedResources.food > 2) {
        const grant = Math.min(4, tribe.sharedResources.food);
        tribe.sharedResources.food -= grant;
        agent.energy += grant * 1.6;
        helped += 1;
        agent.remember(`tribe-help:${grant.toFixed(1)}`);
      }
    });

    if (helped > 0 && deathsThisTick === 0) {
      tribe.stability += 0.03 * helped;
    }
    if (helped === 0 && tribe.sharedResources.food < 1) {
      tribe.stability -= 0.05;
    }
    if (deathsThisTick > 0) {
      tribe.stability -= 0.08 * deathsThisTick;
    }

    tribe.stability = Math.max(0, tribe.stability);

    // keep stock bounded to avoid runaway values
    tribe.sharedResources.food = Math.max(0, Math.min(220, tribe.sharedResources.food));
    tribe.sharedResources.wood = Math.max(0, Math.min(220, tribe.sharedResources.wood));
    tribe.sharedResources.materials = Math.max(0, Math.min(220, tribe.sharedResources.materials));

    // ensure membership mapping stays coherent
    tribe.members.forEach((memberId) => memberToTribe.set(memberId, tribe.id));
  });
}

function computeTribeStats(tribes) {
  const tribeCount = tribes.length;
  const totalMembers = tribes.reduce((sum, tribe) => sum + tribe.members.length, 0);
  return {
    tribeCount,
    averageTribeSize: tribeCount === 0 ? 0 : totalMembers / tribeCount,
  };
}

export function spawnInitialAgents(world, count = 120, seed = world.seed) {
  const agents = [];
  for (let i = 0; i < count; i += 1) {
    const x = Math.floor(makeDeterministicValue(`${seed}|spawn|${i}`, 'x') * world.width);
    const y = Math.floor(makeDeterministicValue(`${seed}|spawn|${i}`, 'y') * world.height);
    agents.push(Agent.spawn({ x, y, seed: `${seed}|spawn|${i}`, labelPrefix: `agent-${i}` }));
  }
  return agents;
}

export function createInitialSimulationState() {
  return {
    tribes: [],
    proximityCounters: {},
  };
}

export function tickSimulation(world, agents, tick, seed = world.seed, simulationState = createInitialSimulationState()) {
  const nextAgents = agents.map((agent) => new Agent(agent.toSerializable()));
  const worldClone = {
    ...world,
    tiles: world.tiles.map((tile) => ({
      ...tile,
      resources: { ...tile.resources },
      resourceCaps: { ...tile.resourceCaps },
    })),
  };

  const previousTribes = (simulationState.tribes ?? []).map((tribe) => new Tribe(tribe.toSerializable ? tribe.toSerializable() : tribe));
  const memberToTribe = new Map();
  previousTribes.forEach((tribe) => tribe.members.forEach((memberId) => memberToTribe.set(memberId, tribe.id)));

  const newborns = [];

  nextAgents.forEach((agent) => {
    if (!agent.isAlive) return;

    moveAgent(agent, worldClone, tick, seed);
    const tribeId = memberToTribe.get(agent.id);
    const tribe = previousTribes.find((item) => item.id === tribeId);
    const tile = worldClone.tiles[tileIndex(worldClone, agent.x, agent.y)];
    harvestFood(agent, tile, tribe);
    applyLifeCosts(agent);
    maybeReproduce(agent, nextAgents, newborns, worldClone, tick, seed);
  });

  const survivors = nextAgents.filter((agent) => agent.isAlive);
  const merged = survivors.concat(newborns);

  const proximityCounters = updateProximityCounters(merged, simulationState.proximityCounters ?? {});
  const exchangeSet = performLocalSharing(merged, proximityCounters);

  const formed = createTribesFromCooperation(merged, previousTribes, proximityCounters, exchangeSet);
  const updated = updateTribesAfterAgentChanges(merged, formed.tribes, formed.memberToTribe);

  tribeSupportMembers(merged, updated.nextTribes, formed.memberToTribe, nextAgents.length - survivors.length);

  const tribeStats = computeTribeStats(updated.nextTribes);

  return {
    world: worldClone,
    agents: merged,
    tribes: updated.nextTribes,
    simulationState: {
      tribes: updated.nextTribes,
      proximityCounters,
    },
    stats: {
      population: merged.length,
      births: newborns.length,
      deaths: nextAgents.length - survivors.length,
      tribes: tribeStats.tribeCount,
      averageTribeSize: tribeStats.averageTribeSize,
      dissolvedTribes: updated.dissolvedCount,
    },
  };
}
