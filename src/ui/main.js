import { createInitialSimulationState, spawnInitialAgents, tickSimulation } from '../engine/simulation.js';
import { runEngineTests } from '../engine/tests.js';
import { generateWorldMap, regenerateWorld } from '../engine/world.js';
import { createWorldRenderer, renderLegend, renderPopulation, renderTests, renderTribeStats } from './renderer.js';

const WORLD_SIZE = 160;
const INITIAL_AGENTS = 120;

const canvas = document.getElementById('worldCanvas');
const seedInput = document.getElementById('seedInput');
const generateButton = document.getElementById('generateButton');
const testsOutput = document.getElementById('testsOutput');
const legend = document.getElementById('legend');
const populationOutput = document.getElementById('populationOutput');
const tribeStatsOutput = document.getElementById('tribeStatsOutput');

const renderer = createWorldRenderer(canvas);
renderLegend(legend);

let currentWorld = null;
let currentAgents = [];
let currentTribes = [];
let currentSimulationState = createInitialSimulationState();
let tick = 0;
let simulationTimer = null;

function buildSimulation(seed) {
  currentWorld = generateWorldMap({ width: WORLD_SIZE, height: WORLD_SIZE, seed });
  currentAgents = spawnInitialAgents(currentWorld, INITIAL_AGENTS, seed);
  currentTribes = [];
  currentSimulationState = createInitialSimulationState();
  tick = 0;

  renderer.render(currentWorld, currentAgents, currentTribes);
  const tests = runEngineTests(currentWorld, seed, currentAgents);
  renderTests(testsOutput, tests);
  renderPopulation(populationOutput, { population: currentAgents.length, births: 0, deaths: 0 });
  renderTribeStats(tribeStatsOutput, { tribes: 0, averageTribeSize: 0, dissolvedTribes: 0 });
}

function stepSimulation() {
  tick += 1;
  currentWorld = regenerateWorld(currentWorld, 1);
  const result = tickSimulation(currentWorld, currentAgents, tick, currentWorld.seed, currentSimulationState);
  currentWorld = result.world;
  currentAgents = result.agents;
  currentTribes = result.tribes;
  currentSimulationState = result.simulationState;

  renderer.render(currentWorld, currentAgents, currentTribes);
  renderPopulation(populationOutput, result.stats);
  renderTribeStats(tribeStatsOutput, result.stats);
}

function startLoop() {
  if (simulationTimer) {
    clearInterval(simulationTimer);
  }

  simulationTimer = setInterval(() => {
    if (!currentWorld) return;
    stepSimulation();
  }, 250);
}

generateButton.addEventListener('click', () => {
  const seed = seedInput.value.trim() || 'default-seed';
  buildSimulation(seed);
  startLoop();
});

buildSimulation(seedInput.value.trim() || 'phase3-demo');
startLoop();
