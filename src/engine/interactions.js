const ACTIONS = ['trade', 'cooperate', 'betray', 'attack', 'avoid'];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampTrust(value) {
  return clamp(value, -1, 1);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function getPowerScore(tribe) {
  return tribe.members.length * (0.8 + tribe.stability * 0.3) + tribe.sharedResources.food * 0.03;
}

export function createInteractionMemoryRecord(previous = {}) {
  return {
    lastActions: previous.lastActions ?? { a: 'avoid', b: 'avoid' },
    trustScore: clampTrust(previous.trustScore ?? 0),
    lastTick: previous.lastTick ?? -1,
    totalTrades: previous.totalTrades ?? 0,
    totalCooperations: previous.totalCooperations ?? 0,
    totalBetrays: previous.totalBetrays ?? 0,
    totalAttacks: previous.totalAttacks ?? 0,
    totalAvoids: previous.totalAvoids ?? 0,
  };
}

export function decideTribeAction(tribeA, tribeB, context, memory, rngValue = 0.5) {
  const memoryRecord = createInteractionMemoryRecord(memory);

  const powerA = getPowerScore(tribeA);
  const powerB = getPowerScore(tribeB);
  const relativePower = powerB <= 0 ? 1 : powerA / powerB;

  const peaceBias = (
    tribeA.culture.trade * 0.35 +
    tribeA.culture.education * 0.2 +
    tribeA.culture.ecology * 0.12 +
    tribeA.culture.spirituality * 0.12 +
    (memoryRecord.trustScore + 1) * 0.15
  );

  const conflictBias = (
    tribeA.culture.war * 0.45 +
    (1 - memoryRecord.trustScore) * 0.2 +
    (memoryRecord.lastActions.b === 'attack' || memoryRecord.lastActions.b === 'betray' ? 0.15 : 0) +
    (relativePower > 1.2 ? 0.1 : 0)
  );

  const vulnerable = relativePower < 0.8 || tribeA.stability < 0.5;
  const noise = (rngValue - 0.5) * (0.2 * (1 - tribeA.culture.education));

  const peace = peaceBias + (context?.peaceBias ?? 0) + noise;
  const conflict = conflictBias + (context?.conflictBias ?? 0) - noise;

  if (vulnerable && memoryRecord.trustScore < -0.2 && conflict > 0.45) {
    return 'avoid';
  }

  if (conflict > 0.7 && relativePower > 0.95) {
    return 'attack';
  }

  if (conflict > peace + 0.1) {
    return 'betray';
  }

  if (peace > 0.72) {
    return 'trade';
  }

  if (peace > 0.52) {
    return 'cooperate';
  }

  return 'avoid';
}

function stealFood(fromTribe, toTribe, amount) {
  const safeAmount = Math.max(0, Math.min(amount, fromTribe.sharedResources.food));
  fromTribe.sharedResources.food = round2(fromTribe.sharedResources.food - safeAmount);
  toTribe.sharedResources.food = round2(toTribe.sharedResources.food + safeAmount);
  return safeAmount;
}

function clampTribeResources(tribe) {
  tribe.sharedResources.food = Math.max(0, round2(tribe.sharedResources.food));
  tribe.sharedResources.wood = Math.max(0, round2(tribe.sharedResources.wood));
  tribe.sharedResources.materials = Math.max(0, round2(tribe.sharedResources.materials));
  tribe.stability = Math.max(0, round2(tribe.stability));
}

export function resolveInteraction(tribeA, tribeB, actionA, actionB, world, rngValue = 0.5) {
  const eventType = actionA === actionB ? actionA : `${actionA}-${actionB}`;
  const result = {
    eventType,
    deadA: 0,
    deadB: 0,
    trustDelta: 0,
  };

  if (actionA === 'trade' && actionB === 'trade') {
    const tradeUnit = Math.min(3, tribeA.sharedResources.food, tribeB.sharedResources.food);
    tribeA.sharedResources.food += 1 + tradeUnit * 0.15;
    tribeB.sharedResources.food += 1 + tradeUnit * 0.15;
    tribeA.stability += 0.04;
    tribeB.stability += 0.04;
    result.trustDelta = 0.08;
  } else if (actionA === 'cooperate' && actionB === 'cooperate') {
    const support = Math.min(2, tribeA.sharedResources.food * 0.1, tribeB.sharedResources.food * 0.1);
    tribeA.sharedResources.food += support;
    tribeB.sharedResources.food += support;
    tribeA.stability += 0.06;
    tribeB.stability += 0.06;
    result.trustDelta = 0.07;
  } else if (actionA === 'betray' && actionB !== 'attack') {
    const stolen = stealFood(tribeB, tribeA, 4 + rngValue * 2);
    tribeA.stability += 0.01;
    tribeB.stability -= 0.08;
    result.trustDelta = stolen > 0 ? -0.16 : -0.08;
  } else if (actionB === 'betray' && actionA !== 'attack') {
    const stolen = stealFood(tribeA, tribeB, 4 + rngValue * 2);
    tribeB.stability += 0.01;
    tribeA.stability -= 0.08;
    result.trustDelta = stolen > 0 ? -0.16 : -0.08;
  } else if (actionA === 'attack' || actionB === 'attack') {
    const intensity = 0.5 + Math.abs(tribeA.culture.war - tribeB.culture.war) * 0.5 + rngValue * 0.3;
    const powerA = getPowerScore(tribeA);
    const powerB = getPowerScore(tribeB);
    const totalPower = Math.max(1, powerA + powerB);

    const lossA = Math.max(0, Math.floor((powerB / totalPower) * intensity * 2));
    const lossB = Math.max(0, Math.floor((powerA / totalPower) * intensity * 2));
    result.deadA = Math.min(lossA, Math.max(0, tribeA.members.length - 1));
    result.deadB = Math.min(lossB, Math.max(0, tribeB.members.length - 1));

    if (powerA > powerB) {
      stealFood(tribeB, tribeA, 3 + rngValue * 2);
    } else if (powerB > powerA) {
      stealFood(tribeA, tribeB, 3 + rngValue * 2);
    }

    tribeA.stability -= 0.12 + result.deadA * 0.04;
    tribeB.stability -= 0.12 + result.deadB * 0.04;
    result.trustDelta = -0.22;
  } else if (actionA === 'avoid' && actionB === 'avoid') {
    tribeA.stability -= 0.01;
    tribeB.stability -= 0.01;
    result.trustDelta = -0.01;
  } else {
    tribeA.stability -= 0.005;
    tribeB.stability -= 0.005;
    result.trustDelta = -0.03;
  }

  clampTribeResources(tribeA);
  clampTribeResources(tribeB);

  return result;
}

export function updateInteractionMemory(memoryRecord, actionA, actionB, trustDelta, tick) {
  const next = createInteractionMemoryRecord(memoryRecord);
  next.lastActions = { a: actionA, b: actionB };
  next.lastTick = tick;
  next.trustScore = clampTrust(next.trustScore + trustDelta);

  const register = (action) => {
    if (action === 'trade') next.totalTrades += 1;
    else if (action === 'cooperate') next.totalCooperations += 1;
    else if (action === 'betray') next.totalBetrays += 1;
    else if (action === 'attack') next.totalAttacks += 1;
    else if (action === 'avoid') next.totalAvoids += 1;
  };

  register(actionA);
  register(actionB);
  return next;
}

export const INTERACTION_ACTIONS = ACTIONS;
