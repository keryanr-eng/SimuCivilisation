const BELIEF_LIMIT_PER_TRIBE = 5;
const BELIEF_DECAY = 0.01;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function pickBeliefTemplate(eventType) {
  if (eventType === 'famine') return { type: 'survival', trigger: 'famine_severe', effect: { harvestMultiplier: 0.9, stabilityBonus: 0.02 } };
  if (eventType === 'mortality') return { type: 'ritual', trigger: 'sacrifice_rite', effect: { sacrificeChance: 0.015, stabilityBonus: 0.03 } };
  if (eventType === 'victory_attack') return { type: 'war', trigger: 'war_destiny', effect: { conflictBias: 0.12, warShift: 0.012 } };
  if (eventType === 'success_trade') return { type: 'trade', trigger: 'trader_path', effect: { peaceBias: 0.1, trustGainBonus: 0.04, tradeShift: 0.01 } };
  if (eventType === 'catastrophe') return { type: 'ecology', trigger: 'sacred_forest', effect: { harvestMultiplier: 0.85, ecologyShift: 0.015 } };
  return null;
}

export function createBelief({ id, type, trigger, effect, strength = 0.3, age = 0 }) {
  return { id, type, trigger, effect: effect ?? {}, strength: clamp01(strength), age: Math.max(0, age) };
}

export function createBeliefFromEvent(tribe, eventType, intensity, tick, seed, rngValue) {
  const template = pickBeliefTemplate(eventType);
  if (!template) return null;
  const probability = clamp(0.05 + tribe.culture.spirituality * 0.25 + intensity * 0.35 + rngValue * 0.05, 0, 0.65);
  if (rngValue > probability) return null;

  return createBelief({
    id: `${tribe.id}-${template.trigger}-${tick}-${Math.floor(rngValue * 10000)}-${seed.length}`,
    type: template.type,
    trigger: template.trigger,
    effect: template.effect,
    strength: clamp01(0.25 + intensity * 0.5 + tribe.culture.spirituality * 0.2),
    age: 0,
  });
}

export function collectBeliefModifiers(tribe) {
  const modifiers = { harvestMultiplier: 1, trustGainBonus: 0, peaceBias: 0, conflictBias: 0 };
  (tribe.beliefs ?? []).forEach((belief) => {
    const w = belief.strength;
    modifiers.harvestMultiplier *= 1 + ((belief.effect.harvestMultiplier ?? 1) - 1) * w;
    modifiers.trustGainBonus += (belief.effect.trustGainBonus ?? 0) * w;
    modifiers.peaceBias += (belief.effect.peaceBias ?? 0) * w;
    modifiers.conflictBias += (belief.effect.conflictBias ?? 0) * w;
  });
  modifiers.harvestMultiplier = clamp(modifiers.harvestMultiplier, 0.65, 1.2);
  return modifiers;
}

export function applyBeliefEffectsOnCulture(tribe) {
  (tribe.beliefs ?? []).forEach((belief) => {
    const w = belief.strength;
    tribe.culture.war = clamp01(tribe.culture.war + (belief.effect.warShift ?? 0) * w);
    tribe.culture.trade = clamp01(tribe.culture.trade + (belief.effect.tradeShift ?? 0) * w);
    tribe.culture.ecology = clamp01(tribe.culture.ecology + (belief.effect.ecologyShift ?? 0) * w);
    tribe.stability = Math.max(0, tribe.stability + (belief.effect.stabilityBonus ?? 0) * w);
  });
}

export function updateBeliefsLifecycle(tribe, feedbackScore) {
  const next = [];
  (tribe.beliefs ?? []).forEach((belief) => {
    const grown = clamp01(belief.strength + feedbackScore * 0.04 - BELIEF_DECAY);
    const aged = createBelief({ ...belief, strength: grown, age: belief.age + 1 });
    if (aged.strength >= 0.06) next.push(aged);
  });
  tribe.beliefs = next.slice(0, BELIEF_LIMIT_PER_TRIBE);
}

export function maybeAddBeliefToTribe(tribe, belief) {
  if (!belief) return;
  const already = (tribe.beliefs ?? []).some((item) => item.trigger === belief.trigger);
  if (already) return;
  tribe.beliefs = [belief, ...(tribe.beliefs ?? [])].slice(0, BELIEF_LIMIT_PER_TRIBE);
}

export function diffuseBelief(sourceTribe, targetTribe, trustScore, rngValue) {
  if ((sourceTribe.beliefs ?? []).length === 0) return false;
  const candidate = sourceTribe.beliefs[0];
  const chance = clamp(0.02 + Math.max(0, trustScore) * 0.25 + candidate.strength * 0.25, 0, 0.45);
  if (rngValue > chance) return false;

  const copied = createBelief({
    ...candidate,
    id: `${targetTribe.id}-diff-${candidate.trigger}-${Math.floor(rngValue * 10000)}`,
    strength: clamp01(candidate.strength * 0.7),
    age: 0,
  });
  maybeAddBeliefToTribe(targetTribe, copied);
  return true;
}

export function summarizeBeliefs(tribes) {
  const all = tribes.flatMap((tribe) => (tribe.beliefs ?? []).map((belief) => ({ tribeId: tribe.id, ...belief })));
  const totalsByTrigger = {};
  all.forEach((belief) => {
    totalsByTrigger[belief.trigger] = (totalsByTrigger[belief.trigger] ?? 0) + belief.strength;
  });

  const topBeliefs = Object.entries(totalsByTrigger)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([trigger, strength]) => ({ trigger, strength: Math.round(strength * 100) / 100 }));

  return { totalBeliefs: all.length, topBeliefs };
}
