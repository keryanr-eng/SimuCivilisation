import { Agent } from './agent.js';
import {
  applyBeliefEffectsOnCulture,
  collectBeliefModifiers,
  createBeliefFromEvent,
  diffuseBelief,
  maybeAddBeliefToTribe,
  summarizeBeliefs,
  updateBeliefsLifecycle,
} from './beliefs.js';
import { advanceEnvironment, createInitialEnvironmentState, eventIntensityAt } from './environment.js';
import {
  createInteractionMemoryRecord,
  decideTribeAction,
  resolveInteraction,
  updateInteractionMemory,
} from './interactions.js';
import { makeDeterministicValue } from './random.js';
import {
  applyStorageCap,
  collectTechnologyEffects,
  summarizeTechnology,
  updateTribeTechnology,
} from './technology.js';
import { Tribe, TRIBE_CULTURE_KEYS, clamp01 } from './tribe.js';
import { regenerateWorld } from './world.js';

const NEAR_DISTANCE = 2;
const SHARE_DISTANCE = 1;
const TRIBE_FORMATION_TICKS = 6;
const MAX_TRIBE_SPREAD = 12;
const MAX_TRIBE_SIZE = 64;
const INTERACTION_DISTANCE = 12;
const INTERACTION_COOLDOWN = 4;

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

export function computeMovementSteps(movementBonus = 0) {
  return 1 + Math.floor(clamp(movementBonus, 0, 0.5) * 2);
}

function bestLocalMove(world, x, y, maxStep, activeEvents = []) {
  let best = { x, y };
  let bestScore = -Infinity;
  for (let dy = -maxStep; dy <= maxStep; dy += 1) {
    for (let dx = -maxStep; dx <= maxStep; dx += 1) {
      const nx = clamp(x + dx, 0, world.width - 1);
      const ny = clamp(y + dy, 0, world.height - 1);
      const tile = world.tiles[tileIndex(world, nx, ny)];
      const richness = tile.resources.food * 1.2 + tile.resources.water * 1.1 + tile.resources.wood * 0.2;
      const danger =
        eventIntensityAt(activeEvents, nx, ny, 'wildfire') * 14 +
        eventIntensityAt(activeEvents, nx, ny, 'flood') * 8 +
        eventIntensityAt(activeEvents, nx, ny, 'coldSnap') * 6;
      const score = richness - danger;
      if (score > bestScore) {
        bestScore = score;
        best = { x: nx, y: ny };
      }
    }
  }
  return best;
}

function moveAgent(agent, world, tick, seed, movementBonus = 0, activeEvents = [], tribeCenter = null) {
  const maxStep = computeMovementSteps(movementBonus);
  const moveSeed = `${seed}|move|${agent.id}|${tick}`;
  const range = maxStep * 2 + 1;
  const driftX = Math.floor(makeDeterministicValue(moveSeed, 'dx') * range) - maxStep;
  const driftY = Math.floor(makeDeterministicValue(moveSeed, 'dy') * range) - maxStep;
  const cautiousBias = agent.traits.prudence > 0.7 ? 0 : 1;

  if (tribeCenter) {
    const toCenterX = Math.round(tribeCenter.x - agent.x);
    const toCenterY = Math.round(tribeCenter.y - agent.y);
    const spread = Math.max(Math.abs(toCenterX), Math.abs(toCenterY));
    if (spread > MAX_TRIBE_SPREAD * 0.6) {
      agent.x = clamp(agent.x + Math.sign(toCenterX) * Math.min(maxStep, Math.abs(toCenterX)), 0, world.width - 1);
      agent.y = clamp(agent.y + Math.sign(toCenterY) * Math.min(maxStep, Math.abs(toCenterY)), 0, world.height - 1);
      return;
    }
  }

  const currentTile = world.tiles[tileIndex(world, agent.x, agent.y)];
  const poorArea = currentTile.resources.food < 18 || currentTile.resources.water < 14;
  const migrateBias = poorArea ? 0.65 : 0.15;
  const migrateRoll = makeDeterministicValue(moveSeed, 'migrate');

  if (migrateRoll < migrateBias) {
    const target = bestLocalMove(world, agent.x, agent.y, maxStep, activeEvents);
    agent.x = target.x;
    agent.y = target.y;
    return;
  }

  agent.x = clamp(agent.x + driftX * cautiousBias, 0, world.width - 1);
  agent.y = clamp(agent.y + driftY * cautiousBias, 0, world.height - 1);
}

export function computeHarvestYield({ availableFood, intelligence, techCulture = 0, ecologyCulture = 0, beliefHarvestMultiplier = 1, efficiencyBonus = 0 }) {
  const basePower = 1.5 + intelligence * 2;
  const techBoost = 1 + techCulture * 0.18;
  const ecologyControl = 1 - ecologyCulture * 0.15;
  const technologyBoost = 1 + clamp(efficiencyBonus, 0, 0.5);
  const desired = basePower * techBoost * ecologyControl * beliefHarvestMultiplier * technologyBoost;
  return Math.max(0, Math.min(availableFood, desired));
}

function harvestFood(agent, tile, tribe, beliefModifier, techEffects) {
  const techCulture = tribe?.culture.tech ?? 0;
  const ecologyCulture = tribe?.culture.ecology ?? 0;
  const taken = computeHarvestYield({
    availableFood: tile.resources.food,
    intelligence: agent.traits.intelligence,
    techCulture,
    ecologyCulture,
    beliefHarvestMultiplier: beliefModifier?.harvestMultiplier ?? 1,
    efficiencyBonus: techEffects?.efficiencyBonus ?? 0,
  });

  tile.resources.food -= taken;

  if (tribe) {
    const contribution = taken * 0.35;
    tribe.sharedResources.food += contribution;
    agent.energy = Math.min(120, agent.energy + (taken - contribution) * 1.8);
  } else {
    agent.energy = Math.min(120, agent.energy + taken * 1.8);
  }

  if (taken > 0) agent.remember(`harvest:${taken.toFixed(2)}`);
  return taken;
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

function maybeReproduce(agent, agents, newborns, world, tick, seed, tribe, memberToTribe) {
  if (!agent.isAlive || agent.energy < 95 || agent.age < 20) return null;
  const roll = makeDeterministicValue(`${seed}|repro|${agent.id}|${tick}`, 'chance');
  const warCulture = tribe?.culture.war ?? 0;
  const chance = 0.02 + agent.traits.patience * 0.02 + warCulture * 0.01;
  if (roll > chance) return null;

  const parentTribeId = memberToTribe.get(agent.id);
  const strictPartner = agents.find((candidate) =>
    candidate.id !== agent.id && candidate.isAlive && candidate.energy >= 85 && candidate.age >= 20
    && Math.abs(candidate.x - agent.x) <= 1 && Math.abs(candidate.y - agent.y) <= 1
    && memberToTribe.get(candidate.id) === parentTribeId,
  );

  const partner = strictPartner ?? agents.find((candidate) =>
    candidate.id !== agent.id && candidate.isAlive && candidate.energy >= 85 && candidate.age >= 20
    && Math.abs(candidate.x - agent.x) <= 1 && Math.abs(candidate.y - agent.y) <= 1,
  );
  if (!partner) return null;

  const childX = clamp(agent.x + (Math.floor(makeDeterministicValue(seed, tick, agent.id, 'cx') * 3) - 1), 0, world.width - 1);
  const childY = clamp(agent.y + (Math.floor(makeDeterministicValue(seed, tick, agent.id, 'cy') * 3) - 1), 0, world.height - 1);
  const educationCulture = tribe?.culture.education ?? 0;
  const mutationScale = Math.max(0.4, 1 - educationCulture * 0.5);

  const child = Agent.reproduce({
    parentA: agent,
    parentB: partner,
    x: childX,
    y: childY,
    seed: `${seed}|child|${agent.id}|${partner.id}|${tick}`,
    mutationScale,
  });

  agent.energy -= 25;
  partner.energy -= 20;
  agent.remember(`reproduce:${child.id}`);
  partner.remember(`reproduce:${child.id}`);
  newborns.push(child);
  return { childId: child.id, parentAId: agent.id, parentBId: partner.id };
}

function updateProximityCounters(agents, previousCounters) {
  const counters = { ...previousCounters };
  const aliveAgents = agents.filter((agent) => agent.isAlive);
  for (let i = 0; i < aliveAgents.length; i += 1) {
    for (let j = i + 1; j < aliveAgents.length; j += 1) {
      const a = aliveAgents[i];
      const b = aliveAgents[j];
      const key = pairKey(a.id, b.id);
      if (distance(a, b) <= NEAR_DISTANCE) counters[key] = (counters[key] ?? 0) + 1;
      else delete counters[key];
    }
  }
  return counters;
}

function performLocalSharing(agents, counters, memberToTribe, tribeById) {
  const exchanges = new Set();
  const aliveAgents = agents.filter((agent) => agent.isAlive);
  for (let i = 0; i < aliveAgents.length; i += 1) {
    for (let j = i + 1; j < aliveAgents.length; j += 1) {
      const a = aliveAgents[i];
      const b = aliveAgents[j];
      const key = pairKey(a.id, b.id);
      if ((counters[key] ?? 0) < 2 || distance(a, b) > SHARE_DISTANCE) continue;
      const tribeA = tribeById.get(memberToTribe.get(a.id));
      const tribeB = tribeById.get(memberToTribe.get(b.id));
      const threshold = 14 + Math.max(tribeA?.culture.war ?? 0, tribeB?.culture.war ?? 0) * 8 * 0.3;
      const donor = a.energy > b.energy ? a : b;
      const receiver = donor === a ? b : a;
      if (donor.energy - receiver.energy > threshold && donor.energy > 55) {
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
  const aliveMap = new Map(agents.filter((agent) => agent.isAlive).map((agent) => [agent.id, agent]));

  tribes.forEach((tribe) => tribe.members.forEach((memberId) => memberToTribe.set(memberId, tribe.id)));

  Object.keys(counters).forEach((key) => {
    if ((counters[key] ?? 0) < TRIBE_FORMATION_TICKS || !exchangeSet.has(key)) return;
    const [idA, idB] = key.split('|');
    if (memberToTribe.has(idA) || memberToTribe.has(idB)) return;
    const founderAgents = [aliveMap.get(idA), aliveMap.get(idB)].filter(Boolean);
    const tribe = new Tribe({
      members: [idA, idB],
      sharedResources: { food: 8, wood: 0, materials: 0 },
      stability: 1,
      culture: Tribe.cultureFromFounderAgents(founderAgents),
      beliefs: [],
      technologies: {},
      techProgressRate: 0,
      globalTechLevel: 0,
    });
    tribe.members.forEach((memberId) => memberToTribe.set(memberId, tribe.id));
    tribes.push(tribe);
  });

  return { tribes, memberToTribe };
}

function recruitAgentsIntoExistingTribes(agents, tribes, memberToTribe, counters, exchangeSet = new Set()) {
  const aliveMap = new Map(agents.filter((agent) => agent.isAlive).map((agent) => [agent.id, agent]));
  const tribeById = new Map(tribes.map((tribe) => [tribe.id, tribe]));
  const supportByAgent = new Map();

  function addSupport(agentId, tribeId, score) {
    let byTribe = supportByAgent.get(agentId);
    if (!byTribe) {
      byTribe = new Map();
      supportByAgent.set(agentId, byTribe);
    }
    byTribe.set(tribeId, (byTribe.get(tribeId) ?? 0) + score);
  }

  Object.entries(counters).forEach(([key, proximityTicks]) => {
    if (proximityTicks < 2) return;
    const [idA, idB] = key.split('|');
    const tribeA = memberToTribe.get(idA);
    const tribeB = memberToTribe.get(idB);
    const supportScore = proximityTicks + (exchangeSet.has(key) ? 2 : 0);

    if (tribeA && !tribeB) addSupport(idB, tribeA, supportScore);
    if (tribeB && !tribeA) addSupport(idA, tribeB, supportScore);
  });

  supportByAgent.forEach((tribeScores, agentId) => {
    if (memberToTribe.has(agentId)) return;
    const agent = aliveMap.get(agentId);
    if (!agent) return;

    let bestTribe = null;
    let bestScore = -Infinity;
    tribeScores.forEach((supportScore, tribeId) => {
      const tribe = tribeById.get(tribeId);
      if (!tribe || tribe.members.length >= MAX_TRIBE_SIZE) return;
      const spread = Math.max(Math.abs(agent.x - tribe.center.x), Math.abs(agent.y - tribe.center.y));
      if (spread > MAX_TRIBE_SPREAD) return;
      const score = supportScore - spread * 0.75 + tribe.stability * 0.3;
      if (score > bestScore) {
        bestScore = score;
        bestTribe = tribe;
      }
    });

    if (!bestTribe || bestScore < 2) return;
    bestTribe.members.push(agentId);
    memberToTribe.set(agentId, bestTribe.id);
  });
}

function assignNewbornsToParentTribes(tribes, memberToTribe, newbornAssignments) {
  if (!newbornAssignments.length) return;
  const tribeById = new Map(tribes.map((tribe) => [tribe.id, tribe]));

  newbornAssignments.forEach((assignment) => {
    if (memberToTribe.has(assignment.childId)) return;
    const tribe = tribeById.get(assignment.tribeId);
    if (!tribe || tribe.members.length >= MAX_TRIBE_SIZE) return;
    tribe.members.push(assignment.childId);
    memberToTribe.set(assignment.childId, assignment.tribeId);
  });
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

  nextTribes.forEach((tribe) => tribe.members.forEach((memberId) => memberToTribe.set(memberId, tribe.id)));
  return { nextTribes, dissolvedCount };
}

function summarizeTribeContext(tribe, aliveAgentMap, world, deathsThisTick, tribeById) {
  const members = tribe.members.map((id) => aliveAgentMap.get(id)).filter(Boolean);
  const totalEnergy = members.reduce((sum, agent) => sum + agent.energy, 0);
  const avgEnergy = members.length > 0 ? totalEnergy / members.length : 0;
  const surplus = tribe.sharedResources.food + Math.max(0, avgEnergy - 70) * members.length * 0.05;
  let depletedTiles = 0;
  members.forEach((agent) => {
    const tile = world.tiles[tileIndex(world, agent.x, agent.y)];
    const ratio = tile.resourceCaps.food <= 0 ? 1 : tile.resources.food / tile.resourceCaps.food;
    if (ratio < 0.25) depletedTiles += 1;
  });
  const overuseRatio = members.length === 0 ? 0 : depletedTiles / members.length;
  let closeExternal = 0;
  tribeById.forEach((other) => {
    if (other.id !== tribe.id && distance(tribe.center, other.center) <= 10) closeExternal += 1;
  });
  return { surplus, overuseRatio, closeExternal, deathsThisTick };
}

function evolveCulture(tribe, context, tick, seed) {
  const nudge = (axis, delta) => {
    const drift = (makeDeterministicValue(`${seed}|culture|${tribe.id}|${tick}`, axis) - 0.5) * 0.004;
    tribe.culture[axis] = clamp01(tribe.culture[axis] + delta + drift);
  };
  if (context.surplus > 14) nudge(makeDeterministicValue(`${seed}|culture-surplus|${tribe.id}|${tick}`, 'focus') > 0.5 ? 'tech' : 'education', 0.01);
  if (context.deathsThisTick > 0) nudge(makeDeterministicValue(`${seed}|culture-loss|${tribe.id}|${tick}`, 'focus') > 0.5 ? 'war' : 'spirituality', 0.012);
  if (context.overuseRatio > 0.35) nudge('ecology', 0.012);
  if (context.closeExternal > 0) nudge('trade', 0.006 * context.closeExternal);
  TRIBE_CULTURE_KEYS.forEach((key) => {
    tribe.culture[key] = clamp01(tribe.culture[key] - 0.001);
  });
}

function addEnvironmentEventsToTribes(tribes, activeEvents, eventMap) {
  tribes.forEach((tribe) => {
    activeEvents.forEach((event) => {
      if (Math.hypot(tribe.center.x - event.x, tribe.center.y - event.y) <= event.radius + 2) {
        if (event.type === 'drought' || event.type === 'coldSnap' || event.type === 'wildfire') {
          eventMap[tribe.id] = [...(eventMap[tribe.id] ?? []), { type: 'catastrophe', intensity: event.intensity }];
          tribe.culture.ecology = clamp01(tribe.culture.ecology + 0.003 * event.intensity);
          tribe.culture.spirituality = clamp01(tribe.culture.spirituality + 0.003 * event.intensity);
        }
      }
    });
  });
}

function tribeSupportMembers(agents, tribes, memberToTribe, world, deathsThisTick, tick, seed, eventMap, techEffectsByTribe) {
  const agentMap = new Map(agents.map((agent) => [agent.id, agent]));
  const tribeById = new Map(tribes.map((tribe) => [tribe.id, tribe]));

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
      }
    });

    if (helped > 0 && deathsThisTick === 0) tribe.stability += 0.03 * helped;
    if (helped === 0 && tribe.sharedResources.food < 1) {
      tribe.stability -= 0.05;
      eventMap[tribe.id] = [...(eventMap[tribe.id] ?? []), { type: 'famine', intensity: 0.7 }];
    }
    if (deathsThisTick > 0) {
      tribe.stability -= 0.08 * deathsThisTick;
      eventMap[tribe.id] = [...(eventMap[tribe.id] ?? []), { type: 'mortality', intensity: Math.min(1, deathsThisTick * 0.12) }];
    }

    const techEffects = techEffectsByTribe.get(tribe.id) ?? { storageBonus: 0 };
    const storageCap = applyStorageCap(220, techEffects.storageBonus);
    tribe.sharedResources.food = Math.max(0, Math.min(storageCap, tribe.sharedResources.food));
    tribe.sharedResources.wood = Math.max(0, Math.min(storageCap, tribe.sharedResources.wood));
    tribe.sharedResources.materials = Math.max(0, Math.min(storageCap, tribe.sharedResources.materials));

    const context = summarizeTribeContext(tribe, agentMap, world, deathsThisTick, tribeById);
    if (context.overuseRatio > 0.5) eventMap[tribe.id] = [...(eventMap[tribe.id] ?? []), { type: 'catastrophe', intensity: 0.6 }];
    evolveCulture(tribe, context, tick, seed);
    tribe.members.forEach((memberId) => memberToTribe.set(memberId, tribe.id));
  });
}

function applyCasualties(tribe, count, agentMap, defenseBonus = 0) {
  const adjustedCount = Math.max(0, Math.floor(count * (1 - clamp(defenseBonus, 0, 0.5))));
  const aliveMembers = tribe.members
    .map((memberId) => agentMap.get(memberId))
    .filter((agent) => agent && agent.isAlive)
    .sort((a, b) => a.energy - b.energy);
  const toRemove = Math.min(adjustedCount, Math.max(0, aliveMembers.length - 1));
  for (let i = 0; i < toRemove; i += 1) {
    const agent = aliveMembers[i];
    agent.isAlive = false;
    agent.energy = 0;
    agent.health = 0;
  }
  return toRemove;
}

function processTribeInteractions(tribes, agents, tick, seed, previousMemory, beliefModifierByTribe, techEffectsByTribe, eventMap) {
  const interactionMemory = { ...previousMemory };
  const interactionEvents = [];
  const breakdown = { trade: 0, cooperate: 0, betray: 0, attack: 0, avoid: 0 };
  const positiveInteractionsByTribe = {};
  const agentMap = new Map(agents.map((agent) => [agent.id, agent]));

  const pairs = [];
  for (let i = 0; i < tribes.length; i += 1) {
    for (let j = i + 1; j < tribes.length; j += 1) {
      if (distance(tribes[i].center, tribes[j].center) < INTERACTION_DISTANCE) pairs.push([tribes[i], tribes[j]]);
    }
  }

  pairs.sort((a, b) => distance(a[0].center, a[1].center) - distance(b[0].center, b[1].center));
  const maxInteractions = Math.min(5, pairs.length);
  let interactionsThisTick = 0;
  let deathsFromInteractions = 0;

  for (let index = 0; index < maxInteractions; index += 1) {
    const [tribeA, tribeB] = pairs[index];
    const memoryKey = pairKey(tribeA.id, tribeB.id);
    const memory = createInteractionMemoryRecord(interactionMemory[memoryKey]);
    const recentConflict = memory.lastTick >= 0 && tick - memory.lastTick <= INTERACTION_COOLDOWN && memory.trustScore < -0.5;

    const modA = beliefModifierByTribe.get(tribeA.id) ?? { peaceBias: 0, conflictBias: 0, trustGainBonus: 0 };
    const modB = beliefModifierByTribe.get(tribeB.id) ?? { peaceBias: 0, conflictBias: 0, trustGainBonus: 0 };
    const techA = techEffectsByTribe.get(tribeA.id) ?? { defenseBonus: 0, tradeBonus: 0 };
    const techB = techEffectsByTribe.get(tribeB.id) ?? { defenseBonus: 0, tradeBonus: 0 };

    const rngA = makeDeterministicValue(`${seed}|interaction|${tick}|${memoryKey}`, 'a');
    const rngB = makeDeterministicValue(`${seed}|interaction|${tick}|${memoryKey}`, 'b');

    let actionA = decideTribeAction(tribeA, tribeB, { tick, recentConflict, peaceBias: modA.peaceBias, conflictBias: modA.conflictBias }, memory, rngA);
    let actionB = decideTribeAction(tribeB, tribeA, { tick, recentConflict, peaceBias: modB.peaceBias, conflictBias: modB.conflictBias }, {
      ...memory,
      lastActions: { a: memory.lastActions.b, b: memory.lastActions.a },
    }, rngB);
    if (recentConflict) {
      if (actionA === 'attack') actionA = 'avoid';
      if (actionB === 'attack') actionB = 'avoid';
    }

    const outcome = resolveInteraction(tribeA, tribeB, actionA, actionB, null, (rngA + rngB) / 2);
    const killedA = applyCasualties(tribeA, outcome.deadA, agentMap, techA.defenseBonus);
    const killedB = applyCasualties(tribeB, outcome.deadB, agentMap, techB.defenseBonus);
    deathsFromInteractions += killedA + killedB;

    const trustDeltaBoosted = outcome.trustDelta * (1 + Math.max(techA.tradeBonus ?? 0, techB.tradeBonus ?? 0)) + (modA.trustGainBonus + modB.trustGainBonus) * 0.5;
    interactionMemory[memoryKey] = updateInteractionMemory(memory, actionA, actionB, trustDeltaBoosted, tick);

    diffuseBelief(tribeA, tribeB, interactionMemory[memoryKey].trustScore, makeDeterministicValue(`${seed}|belief-diffuse|${tick}|${memoryKey}`, 'ab'));
    diffuseBelief(tribeB, tribeA, interactionMemory[memoryKey].trustScore, makeDeterministicValue(`${seed}|belief-diffuse|${tick}|${memoryKey}`, 'ba'));

    if (actionA === 'trade' && actionB === 'trade') {
      eventMap[tribeA.id] = [...(eventMap[tribeA.id] ?? []), { type: 'success_trade', intensity: 0.6 }];
      eventMap[tribeB.id] = [...(eventMap[tribeB.id] ?? []), { type: 'success_trade', intensity: 0.6 }];
      positiveInteractionsByTribe[tribeA.id] = (positiveInteractionsByTribe[tribeA.id] ?? 0) + 1;
      positiveInteractionsByTribe[tribeB.id] = (positiveInteractionsByTribe[tribeB.id] ?? 0) + 1;
    }
    if (actionA === 'cooperate' && actionB === 'cooperate') {
      positiveInteractionsByTribe[tribeA.id] = (positiveInteractionsByTribe[tribeA.id] ?? 0) + 1;
      positiveInteractionsByTribe[tribeB.id] = (positiveInteractionsByTribe[tribeB.id] ?? 0) + 1;
    }
    if (actionA === 'attack' || actionB === 'attack') {
      if (killedB > killedA) eventMap[tribeA.id] = [...(eventMap[tribeA.id] ?? []), { type: 'victory_attack', intensity: 0.7 }];
      if (killedA > killedB) eventMap[tribeB.id] = [...(eventMap[tribeB.id] ?? []), { type: 'victory_attack', intensity: 0.7 }];
    }

    breakdown[actionA] += 1;
    breakdown[actionB] += 1;
    interactionEvents.push({ from: { ...tribeA.center }, to: { ...tribeB.center }, actionA, actionB, eventType: outcome.eventType });
    interactionsThisTick += 1;
  }

  return { interactionMemory, interactionEvents, interactionsThisTick, breakdown, deathsFromInteractions, positiveInteractionsByTribe };
}

function processBeliefs(tribes, eventMap, tick, seed) {
  tribes.forEach((tribe) => {
    const tribeEvents = eventMap[tribe.id] ?? [];
    tribeEvents.forEach((evt, idx) => {
      const belief = createBeliefFromEvent(tribe, evt.type, evt.intensity, tick, seed, makeDeterministicValue(`${seed}|belief-create|${tribe.id}|${tick}|${idx}`, 'roll'));
      maybeAddBeliefToTribe(tribe, belief);
    });
    updateBeliefsLifecycle(tribe, tribe.stability > 1 ? 0.4 : -0.2);
    applyBeliefEffectsOnCulture(tribe);
  });
}

function updateTechnologies(tribes, positiveInteractionsByTribe) {
  tribes.forEach((tribe) => {
    const surplus = Math.max(0, tribe.sharedResources.food - tribe.members.length * 2);
    updateTribeTechnology(tribe, { surplus, positiveInteractions: positiveInteractionsByTribe[tribe.id] ?? 0 });
  });
}

function computeTribeStats(tribes) {
  const tribeCount = tribes.length;
  const totalMembers = tribes.reduce((sum, tribe) => sum + tribe.members.length, 0);
  const cultureAverage = { tech: 0, war: 0, education: 0, trade: 0, ecology: 0, spirituality: 0 };
  if (tribeCount > 0) {
    TRIBE_CULTURE_KEYS.forEach((key) => {
      cultureAverage[key] = tribes.reduce((sum, tribe) => sum + tribe.culture[key], 0) / tribeCount;
    });
  }
  return { tribeCount, averageTribeSize: tribeCount === 0 ? 0 : totalMembers / tribeCount, cultureAverage };
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
    interactionMemory: {},
    environmentState: createInitialEnvironmentState(),
    activeEvents: [],
  };
}

export function tickSimulation(world, agents, tick, seed = world.seed, simulationState = createInitialSimulationState()) {
  const envUpdate = advanceEnvironment({
    environmentState: simulationState.environmentState,
    activeEvents: simulationState.activeEvents,
    tick,
    seed,
    width: world.width,
    height: world.height,
  });

  const worldClone = regenerateWorld(world, 1, envUpdate.environmentState, envUpdate.activeEvents);
  const nextAgents = agents.map((agent) => new Agent(agent.toSerializable()));

  const previousTribes = (simulationState.tribes ?? []).map((tribe) => new Tribe(tribe.toSerializable ? tribe.toSerializable() : tribe));
  previousTribes.forEach((tribe) => applyBeliefEffectsOnCulture(tribe));
  const beliefModifierByTribe = new Map(previousTribes.map((tribe) => [tribe.id, collectBeliefModifiers(tribe)]));
  const techEffectsByTribe = new Map(previousTribes.map((tribe) => [tribe.id, collectTechnologyEffects(tribe)]));

  const memberToTribe = new Map();
  previousTribes.forEach((tribe) => tribe.members.forEach((memberId) => memberToTribe.set(memberId, tribe.id)));
  const tribeById = new Map(previousTribes.map((tribe) => [tribe.id, tribe]));

  const newborns = [];
  const newbornAssignments = [];
  nextAgents.forEach((agent) => {
    if (!agent.isAlive) return;
    const tribe = tribeById.get(memberToTribe.get(agent.id));
    const beliefModifier = beliefModifierByTribe.get(tribe?.id);
    const techEffects = techEffectsByTribe.get(tribe?.id) ?? { movementBonus: 0, efficiencyBonus: 0 };
    moveAgent(agent, worldClone, tick, seed, techEffects.movementBonus, envUpdate.activeEvents, tribe?.center ?? null);
    const tile = worldClone.tiles[tileIndex(worldClone, agent.x, agent.y)];
    harvestFood(agent, tile, tribe, beliefModifier, techEffects);
    applyLifeCosts(agent);
    const birth = maybeReproduce(agent, nextAgents, newborns, worldClone, tick, seed, tribe, memberToTribe);
    if (birth) {
      const tribeIdA = memberToTribe.get(birth.parentAId);
      const tribeIdB = memberToTribe.get(birth.parentBId);
      const targetTribeId = tribeIdA ?? tribeIdB;
      if (targetTribeId) newbornAssignments.push({ childId: birth.childId, tribeId: targetTribeId });
    }
  });

  const survivors = nextAgents.filter((agent) => agent.isAlive);
  const merged = survivors.concat(newborns);
  const proximityCounters = updateProximityCounters(merged, simulationState.proximityCounters ?? {});
  const exchangeSet = performLocalSharing(merged, proximityCounters, memberToTribe, tribeById);
  const formed = createTribesFromCooperation(merged, previousTribes, proximityCounters, exchangeSet);
  assignNewbornsToParentTribes(formed.tribes, formed.memberToTribe, newbornAssignments);
  recruitAgentsIntoExistingTribes(merged, formed.tribes, formed.memberToTribe, proximityCounters, exchangeSet);
  const updated = updateTribesAfterAgentChanges(merged, formed.tribes, formed.memberToTribe);

  const deathsFromEnergy = nextAgents.length - survivors.length;
  const eventMap = {};
  const updatedTechEffects = new Map(updated.nextTribes.map((tribe) => [tribe.id, collectTechnologyEffects(tribe)]));
  tribeSupportMembers(merged, updated.nextTribes, formed.memberToTribe, worldClone, deathsFromEnergy, tick, seed, eventMap, updatedTechEffects);
  addEnvironmentEventsToTribes(updated.nextTribes, envUpdate.activeEvents, eventMap);

  const interactionResults = processTribeInteractions(
    updated.nextTribes,
    merged,
    tick,
    seed,
    simulationState.interactionMemory ?? {},
    beliefModifierByTribe,
    updatedTechEffects,
    eventMap,
  );

  processBeliefs(updated.nextTribes, eventMap, tick, seed);
  updateTechnologies(updated.nextTribes, interactionResults.positiveInteractionsByTribe);

  const postInteraction = updateTribesAfterAgentChanges(merged, updated.nextTribes, formed.memberToTribe);
  const aliveAfterInteraction = merged.filter((agent) => agent.isAlive);

  const tribeStats = computeTribeStats(postInteraction.nextTribes);
  const beliefStats = summarizeBeliefs(postInteraction.nextTribes);
  const technologyStats = summarizeTechnology(postInteraction.nextTribes);
  const trustValues = Object.values(interactionResults.interactionMemory).map((item) => item.trustScore).filter((value) => !Number.isNaN(value));
  const meanTrustScore = trustValues.length ? trustValues.reduce((sum, value) => sum + value, 0) / trustValues.length : 0;
  const meanEventIntensity = envUpdate.activeEvents.length
    ? envUpdate.activeEvents.reduce((sum, event) => sum + event.intensity, 0) / envUpdate.activeEvents.length
    : 0;

  return {
    world: worldClone,
    agents: aliveAfterInteraction,
    tribes: postInteraction.nextTribes,
    interactionEvents: interactionResults.interactionEvents,
    simulationState: {
      tribes: postInteraction.nextTribes,
      proximityCounters,
      interactionMemory: interactionResults.interactionMemory,
      environmentState: envUpdate.environmentState,
      activeEvents: envUpdate.activeEvents,
    },
    stats: {
      population: aliveAfterInteraction.length,
      births: newborns.length,
      deaths: deathsFromEnergy + interactionResults.deathsFromInteractions,
      tribes: tribeStats.tribeCount,
      averageTribeSize: tribeStats.averageTribeSize,
      dissolvedTribes: updated.dissolvedCount + postInteraction.dissolvedCount,
      cultureAverage: tribeStats.cultureAverage,
      interactionsThisTick: interactionResults.interactionsThisTick,
      interactionBreakdown: interactionResults.breakdown,
      totalBeliefs: beliefStats.totalBeliefs,
      topBeliefs: beliefStats.topBeliefs,
      meanGlobalTechLevel: technologyStats.meanGlobalTechLevel,
      totalTechLevels: technologyStats.totalTechLevels,
      techLevelDistribution: technologyStats.levelDistribution,
      meanTrustScore,
      seasonName: envUpdate.environmentState.seasonState.seasonName,
      year: envUpdate.environmentState.seasonState.year,
      globalTempShift: envUpdate.environmentState.globalClimateState.globalTempShift,
      globalHumidityShift: envUpdate.environmentState.globalClimateState.globalHumidityShift,
      activeEventsCount: envUpdate.activeEvents.length,
      meanEventIntensity,
    },
  };
}
