import { clampTechnologyState } from './technology.js';

let TRIBE_SEQ = 1;

const CULTURE_KEYS = ['tech', 'war', 'education', 'trade', 'ecology', 'spirituality'];

function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export class Tribe {
  constructor({ id, members = [], sharedResources, center = { x: 0, y: 0 }, stability = 1, culture, beliefs = [], technologies = {}, techProgressRate = 0, globalTechLevel = 0, techActiveEffects }) {
    this.id = id ?? `tribe-${TRIBE_SEQ++}`;
    this.members = [...new Set(members)];
    this.sharedResources = {
      food: sharedResources?.food ?? 0,
      wood: sharedResources?.wood ?? 0,
      materials: sharedResources?.materials ?? 0,
    };
    this.center = { x: center.x, y: center.y };
    this.stability = Math.max(0, stability);
    this.culture = {
      tech: clamp01(culture?.tech ?? 0.5),
      war: clamp01(culture?.war ?? 0.5),
      education: clamp01(culture?.education ?? 0.5),
      trade: clamp01(culture?.trade ?? 0.5),
      ecology: clamp01(culture?.ecology ?? 0.5),
      spirituality: clamp01(culture?.spirituality ?? 0.5),
    };
    this.beliefs = beliefs.map((belief) => ({ ...belief, strength: clamp01(belief.strength ?? 0), age: Math.max(0, belief.age ?? 0) }));

    this.technologies = { ...technologies };
    this.techProgressRate = Math.max(0, techProgressRate);
    this.globalTechLevel = Math.max(0, Math.floor(globalTechLevel));
    this.techActiveEffects = {
      efficiencyBonus: techActiveEffects?.efficiencyBonus ?? 0,
      storageBonus: techActiveEffects?.storageBonus ?? 0,
      movementBonus: techActiveEffects?.movementBonus ?? 0,
      defenseBonus: techActiveEffects?.defenseBonus ?? 0,
      tradeBonus: techActiveEffects?.tradeBonus ?? 0,
    };

    clampTechnologyState(this);
  }

  refreshCenter(agentMap) {
    const memberAgents = this.members.map((id) => agentMap.get(id)).filter(Boolean);
    if (memberAgents.length === 0) {
      this.center = { x: 0, y: 0 };
      return;
    }

    this.center = {
      x: average(memberAgents.map((agent) => agent.x)),
      y: average(memberAgents.map((agent) => agent.y)),
    };
  }

  toSerializable() {
    return {
      id: this.id,
      members: [...this.members],
      sharedResources: { ...this.sharedResources },
      center: { ...this.center },
      stability: this.stability,
      culture: { ...this.culture },
      beliefs: this.beliefs.map((belief) => ({ ...belief, effect: { ...belief.effect } })),
      technologies: Object.fromEntries(
        Object.entries(this.technologies).map(([id, tech]) => [id, { ...tech, effects: { ...tech.effects } }]),
      ),
      techProgressRate: this.techProgressRate,
      globalTechLevel: this.globalTechLevel,
      techActiveEffects: { ...this.techActiveEffects },
    };
  }

  dominantCultureAxis() {
    let bestKey = CULTURE_KEYS[0];
    let bestValue = this.culture[bestKey];
    CULTURE_KEYS.forEach((key) => {
      if (this.culture[key] > bestValue) {
        bestKey = key;
        bestValue = this.culture[key];
      }
    });
    return bestKey;
  }

  static cultureFromFounderAgents(agents) {
    if (!agents || agents.length === 0) {
      return { tech: 0.5, war: 0.5, education: 0.5, trade: 0.5, ecology: 0.5, spirituality: 0.5 };
    }

    const avg = (reader) => agents.reduce((sum, agent) => sum + reader(agent), 0) / agents.length;

    return {
      tech: clamp01(avg((agent) => agent.traits.intelligence)),
      war: clamp01(avg((agent) => agent.traits.agressivite)),
      education: clamp01(avg((agent) => 1 - agent.traits.curiosite * 0.5 + agent.traits.patience * 0.5)),
      trade: clamp01(avg((agent) => 0.5 + (agent.traits.curiosite - agent.traits.agressivite) * 0.4)),
      ecology: clamp01(avg((agent) => agent.traits.conscience_ecologique)),
      spirituality: clamp01(avg((agent) => 0.4 + agent.traits.prudence * 0.6)),
    };
  }
}

export function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export const TRIBE_CULTURE_KEYS = CULTURE_KEYS;
