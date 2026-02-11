import { makeDeterministicValue } from './random.js';

const TRAIT_KEYS = Object.freeze([
  'curiosite',
  'intelligence',
  'agressivite',
  'prudence',
  'patience',
  'conscience_ecologique',
]);

let AGENT_SEQ = 1;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function randomTrait(seed, label, fallback = Math.random()) {
  const base = seed ? makeDeterministicValue(seed, label) : fallback;
  return clamp01(base);
}

function makeTraits(seed, labelPrefix = 'trait') {
  return {
    curiosite: randomTrait(seed, `${labelPrefix}:curiosite`),
    intelligence: randomTrait(seed, `${labelPrefix}:intelligence`),
    agressivite: randomTrait(seed, `${labelPrefix}:agressivite`),
    prudence: randomTrait(seed, `${labelPrefix}:prudence`),
    patience: randomTrait(seed, `${labelPrefix}:patience`),
    conscience_ecologique: randomTrait(seed, `${labelPrefix}:conscience_ecologique`),
  };
}

function mutateTrait(baseValue, seed, label) {
  const mutationUnit = seed ? makeDeterministicValue(seed, `mutation:${label}`) : Math.random();
  const mutation = (mutationUnit - 0.5) * 0.12;
  return clamp01(baseValue + mutation);
}

export class Agent {
  constructor({ id, x, y, energy = 70, health = 100, age = 0, traits, memory = [], isAlive = true }) {
    this.id = id ?? `agent-${AGENT_SEQ++}`;
    this.x = x;
    this.y = y;
    this.energy = energy;
    this.health = health;
    this.age = age;
    this.traits = traits;
    this.memory = memory.slice(-10);
    this.isAlive = isAlive;
  }

  remember(eventText) {
    this.memory.push(eventText);
    if (this.memory.length > 10) {
      this.memory.shift();
    }
  }

  toSerializable() {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      energy: this.energy,
      health: this.health,
      age: this.age,
      traits: { ...this.traits },
      memory: [...this.memory],
      isAlive: this.isAlive,
    };
  }

  static spawn({ x, y, seed, labelPrefix = 'spawn' }) {
    return new Agent({
      x,
      y,
      energy: 60 + randomTrait(seed, `${labelPrefix}:energy`) * 30,
      health: 100,
      age: 0,
      traits: makeTraits(seed, labelPrefix),
      memory: ['spawn'],
    });
  }

  static reproduce({ parentA, parentB, x, y, seed }) {
    const childTraits = {};
    TRAIT_KEYS.forEach((key) => {
      const base = (parentA.traits[key] + parentB.traits[key]) / 2;
      childTraits[key] = mutateTrait(base, seed, key);
    });

    return new Agent({
      x,
      y,
      energy: 50,
      health: 100,
      age: 0,
      traits: childTraits,
      memory: [`born:${parentA.id}+${parentB.id}`],
    });
  }
}

export function createTraitsForTest(values = {}) {
  return {
    curiosite: values.curiosite ?? 0.5,
    intelligence: values.intelligence ?? 0.5,
    agressivite: values.agressivite ?? 0.5,
    prudence: values.prudence ?? 0.5,
    patience: values.patience ?? 0.5,
    conscience_ecologique: values.conscience_ecologique ?? 0.5,
  };
}

export const AGENT_TRAIT_KEYS = TRAIT_KEYS;
