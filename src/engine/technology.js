function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function dominantAxis(culture) {
  const keys = Object.keys(culture ?? {});
  if (!keys.length) return 'tech';
  return keys.reduce((best, key) => ((culture[key] ?? 0) > (culture[best] ?? 0) ? key : best), keys[0]);
}

export function createTechnology({ id, level = 0, progress = 0, cost = 20, effects }) {
  return {
    id,
    level: Math.max(0, Math.floor(level)),
    progress: Math.max(0, progress),
    cost: Math.max(1, cost),
    effects: {
      efficiencyBonus: clamp(effects?.efficiencyBonus ?? 0, 0, 0.5),
      storageBonus: clamp(effects?.storageBonus ?? 0, 0, 0.5),
      movementBonus: clamp(effects?.movementBonus ?? 0, 0, 0.5),
      defenseBonus: clamp(effects?.defenseBonus ?? 0, 0, 0.5),
      tradeBonus: clamp(effects?.tradeBonus ?? 0, 0, 0.5),
    },
  };
}

export function computeTechnologyEffects({ level, culture, focus }) {
  const lvl = Math.max(0, level);
  const base = Math.min(0.5, 0.02 * lvl + (culture.education ?? 0) * 0.08 + (culture.tech ?? 0) * 0.08);

  const profile = {
    efficiencyBonus: base * (focus === 'tech' ? 1.2 : 0.7) + (culture.tech ?? 0) * 0.1,
    storageBonus: base * (focus === 'ecology' ? 1.0 : 0.7) + (culture.ecology ?? 0) * 0.08,
    movementBonus: base * (focus === 'war' ? 1.0 : 0.6) + (culture.war ?? 0) * 0.06,
    defenseBonus: base * (focus === 'war' ? 1.2 : 0.6) + (culture.spirituality ?? 0) * 0.05,
    tradeBonus: base * (focus === 'trade' ? 1.3 : 0.7) + (culture.trade ?? 0) * 0.1,
  };

  return {
    efficiencyBonus: clamp(profile.efficiencyBonus, 0, 0.5),
    storageBonus: clamp(profile.storageBonus, 0, 0.5),
    movementBonus: clamp(profile.movementBonus, 0, 0.5),
    defenseBonus: clamp(profile.defenseBonus, 0, 0.5),
    tradeBonus: clamp(profile.tradeBonus, 0, 0.5),
  };
}

function ensureTechnologyForDominantCulture(tribe) {
  const focus = dominantAxis(tribe.culture);
  const id = `emergent-${focus}`;
  if (!tribe.technologies[id]) {
    tribe.technologies[id] = createTechnology({
      id,
      level: 0,
      progress: 0,
      cost: 18,
      effects: computeTechnologyEffects({ level: 0, culture: tribe.culture, focus }),
    });
  }
  return id;
}

export function computeTechProgressRate({ tribe, surplus, positiveInteractions }) {
  const sizeFactor = Math.min(1.2, tribe.members.length / 25);
  const stabilityFactor = clamp(tribe.stability / 2, 0.2, 1.2);
  const surplusFactor = clamp(surplus / 35, 0, 1.4);
  const interactionFactor = Math.min(0.8, positiveInteractions * 0.18);

  const base = 0.06;
  const rate = base
    + tribe.culture.tech * 0.22
    + tribe.culture.education * 0.18
    + sizeFactor * 0.07
    + stabilityFactor * 0.08
    + surplusFactor * 0.09
    + interactionFactor;

  return Math.max(0, rate);
}

export function updateTribeTechnology(tribe, { surplus = 0, positiveInteractions = 0 } = {}) {
  if (!tribe.technologies) tribe.technologies = {};
  const techId = ensureTechnologyForDominantCulture(tribe);
  const tech = createTechnology(tribe.technologies[techId]);

  const slowdown = 1 / (1 + tech.level * 0.35);
  const progressRate = computeTechProgressRate({ tribe, surplus, positiveInteractions }) * slowdown;
  tech.progress += progressRate;

  while (tech.progress >= tech.cost) {
    tech.progress -= tech.cost;
    tech.level += 1;
    tech.cost *= 1.5;
    tech.effects = computeTechnologyEffects({ level: tech.level, culture: tribe.culture, focus: techId.replace('emergent-', '') });
  }

  tech.progress = clamp(tech.progress, 0, tech.cost - 1e-6);
  tribe.technologies[techId] = tech;
  tribe.techProgressRate = progressRate;

  const levels = Object.values(tribe.technologies).reduce((sum, item) => sum + item.level, 0);
  tribe.globalTechLevel = levels;
  tribe.techActiveEffects = collectTechnologyEffects(tribe);
}

export function collectTechnologyEffects(tribe) {
  const totals = {
    efficiencyBonus: 0,
    storageBonus: 0,
    movementBonus: 0,
    defenseBonus: 0,
    tradeBonus: 0,
  };

  Object.values(tribe.technologies ?? {}).forEach((tech) => {
    totals.efficiencyBonus += tech.effects.efficiencyBonus;
    totals.storageBonus += tech.effects.storageBonus;
    totals.movementBonus += tech.effects.movementBonus;
    totals.defenseBonus += tech.effects.defenseBonus;
    totals.tradeBonus += tech.effects.tradeBonus;
  });

  return {
    efficiencyBonus: clamp(totals.efficiencyBonus, 0, 0.5),
    storageBonus: clamp(totals.storageBonus, 0, 0.5),
    movementBonus: clamp(totals.movementBonus, 0, 0.5),
    defenseBonus: clamp(totals.defenseBonus, 0, 0.5),
    tradeBonus: clamp(totals.tradeBonus, 0, 0.5),
  };
}

export function summarizeTechnology(tribes) {
  if (!tribes.length) {
    return {
      meanGlobalTechLevel: 0,
      totalTechLevels: 0,
      levelDistribution: {},
    };
  }

  const distribution = {};
  let total = 0;

  tribes.forEach((tribe) => {
    const level = Math.max(0, Math.floor(tribe.globalTechLevel ?? 0));
    total += level;
    distribution[level] = (distribution[level] ?? 0) + 1;
  });

  return {
    meanGlobalTechLevel: total / tribes.length,
    totalTechLevels: total,
    levelDistribution: distribution,
  };
}

export function applyStorageCap(baseCap, storageBonus) {
  return Math.max(0, baseCap * (1 + clamp(storageBonus, 0, 0.5)));
}

export function clampTechnologyState(tribe) {
  tribe.techProgressRate = Math.max(0, tribe.techProgressRate ?? 0);
  tribe.globalTechLevel = Math.max(0, Math.floor(tribe.globalTechLevel ?? 0));

  Object.keys(tribe.technologies ?? {}).forEach((id) => {
    const tech = createTechnology(tribe.technologies[id]);
    tribe.technologies[id] = tech;
  });

  tribe.techActiveEffects = collectTechnologyEffects(tribe);
  tribe.techActiveEffects.efficiencyBonus = clamp01(tribe.techActiveEffects.efficiencyBonus / 0.5) * 0.5;
}
