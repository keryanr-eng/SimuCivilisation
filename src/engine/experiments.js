import { createInitialSimulationState, spawnInitialAgents, tickSimulation } from './simulation.js';
import { generateWorldMap, regenerateWorld } from './world.js';

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function variance(values) {
  if (!values.length) return 0;
  const m = mean(values);
  return mean(values.map((v) => (v - m) ** 2));
}

function summarize(values) {
  return {
    mean: mean(values),
    variance: variance(values),
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
  };
}

export function runExperiments({ runs = 10, ticksPerRun = 300, worldSize = 160, baseSeed = 'experiment' }) {
  const records = [];

  for (let i = 0; i < runs; i += 1) {
    const seed = `${baseSeed}-${i + 1}`;
    let world = generateWorldMap({ width: worldSize, height: worldSize, seed });
    let agents = spawnInitialAgents(world, 120, seed);
    let state = createInitialSimulationState();
    let lastStats = null;

    for (let tick = 1; tick <= ticksPerRun; tick += 1) {
      world = regenerateWorld(world, 1);
      const out = tickSimulation(world, agents, tick, seed, state);
      world = out.world;
      agents = out.agents;
      state = out.simulationState;
      lastStats = out.stats;
    }

    records.push({
      seed,
      finalPopulation: lastStats?.population ?? agents.length,
      finalTribes: lastStats?.tribes ?? 0,
      meanTech: lastStats?.meanGlobalTechLevel ?? 0,
      totalBeliefs: lastStats?.totalBeliefs ?? 0,
      meanTrust: lastStats?.meanTrustScore ?? 0,
    });
  }

  const populations = records.map((r) => r.finalPopulation);
  const tribes = records.map((r) => r.finalTribes);
  const tech = records.map((r) => r.meanTech);
  const beliefs = records.map((r) => r.totalBeliefs);
  const trust = records.map((r) => r.meanTrust);

  return {
    runs,
    ticksPerRun,
    records,
    summary: {
      population: summarize(populations),
      tribes: summarize(tribes),
      tech: summarize(tech),
      beliefs: summarize(beliefs),
      trust: summarize(trust),
    },
  };
}
