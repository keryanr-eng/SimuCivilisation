import { runExperiments } from '../engine/experiments.js';
import { createInitialSimulationState, spawnInitialAgents, tickSimulation } from '../engine/simulation.js';
import { deserializeAll, serializeAll } from '../engine/serialize.js';
import { generateWorldMap } from '../engine/world.js';
import {
  createWorldRenderer,
  renderBeliefStats,
  renderGlobalCulture,
  renderInteractionStats,
  renderLegend,
  renderPopulation,
  renderTechnologyStats,
  renderTribeCulture,
  renderTribeStats,
} from './renderer.js';
import { createChartsRenderer, createChartStore } from './charts.js';

const WORLD_SIZE = 160;
const INITIAL_AGENTS = 80;
const SIMULATION_INTERVAL_MS = 450;
const UI_UPDATE_EVERY_TICKS = 3;
const MAX_RENDERED_TRIBES = 10;
const SNAPSHOT_EVERY = 50;
const MAX_SNAPSHOTS = 20;

const canvas = document.getElementById('worldCanvas');
const seedInput = document.getElementById('seedInput');
const generateButton = document.getElementById('generateButton');
const saveButton = document.getElementById('saveButton');
const loadButton = document.getElementById('loadButton');
const snapshotSelect = document.getElementById('snapshotSelect');
const loadSnapshotButton = document.getElementById('loadSnapshotButton');
const testsOutput = document.getElementById('testsOutput');
const legend = document.getElementById('legend');
const populationOutput = document.getElementById('populationOutput');
const tribeStatsOutput = document.getElementById('tribeStatsOutput');
const cultureAverageOutput = document.getElementById('cultureAverageOutput');
const interactionOutput = document.getElementById('interactionOutput');
const beliefOutput = document.getElementById('beliefOutput');
const technologyOutput = document.getElementById('technologyOutput');
const tickOutput = document.getElementById('tickOutput');
const statusOutput = document.getElementById('statusOutput');
const seasonOutput = document.getElementById('seasonOutput');
const climateOutput = document.getElementById('climateOutput');
const eventsOutput = document.getElementById('eventsOutput');
const tribeCultureOutput = document.getElementById('tribeCultureOutput');
const runsInput = document.getElementById('runsInput');
const ticksPerRunInput = document.getElementById('ticksPerRunInput');
const runExperimentsButton = document.getElementById('runExperimentsButton');
const experimentsOutput = document.getElementById('experimentsOutput');

const popChart = document.getElementById('popChart');
const tribeChart = document.getElementById('tribeChart');
const techChart = document.getElementById('techChart');
const beliefChart = document.getElementById('beliefChart');
const interactionChart = document.getElementById('interactionChart');
const eventsChart = document.getElementById('eventsChart');

const renderer = createWorldRenderer(canvas);
const chartStore = createChartStore(1200);
const chartsRenderer = createChartsRenderer({
  popCanvas: popChart,
  tribeCanvas: tribeChart,
  techCanvas: techChart,
  beliefCanvas: beliefChart,
  interactionCanvas: interactionChart,
  eventsCanvas: eventsChart,
});
renderLegend(legend);

let currentWorld = null;
let currentAgents = [];
let currentTribes = [];
let currentInteractionEvents = [];
let currentSimulationState = createInitialSimulationState();
let tick = 0;
let simulationTimer = null;

function storageKey(seed) {
  return `simuciv:phase8:${seed}`;
}

function savePayload() {
  return serializeAll({ world: currentWorld, agents: currentAgents, state: currentSimulationState, tick, seed: currentWorld.seed });
}

function readStorage(seed) {
  try {
    const raw = localStorage.getItem(storageKey(seed));
    if (!raw) return { saves: [], snapshots: [] };
    const parsed = JSON.parse(raw);
    return { saves: parsed.saves ?? [], snapshots: parsed.snapshots ?? [] };
  } catch {
    return { saves: [], snapshots: [] };
  }
}

function writeStorage(seed, data) {
  localStorage.setItem(storageKey(seed), JSON.stringify(data));
}

function refreshSnapshotDropdown(seed) {
  const { snapshots } = readStorage(seed);
  snapshotSelect.innerHTML = '';
  snapshots.forEach((entry, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `tick ${entry.tick} - ${new Date(entry.savedAt).toLocaleTimeString()}`;
    snapshotSelect.appendChild(option);
  });
}

function setStatus(text) { statusOutput.textContent = text; }
function updateTickLabel() { tickOutput.textContent = `Tick courant: ${tick}`; }
function shouldRenderFullUi(currentTick) { return currentTick <= 2 || currentTick % UI_UPDATE_EVERY_TICKS === 0; }

function renderTribeCulturePanel(tribes) {
  const visible = tribes.slice(0, MAX_RENDERED_TRIBES);
  renderTribeCulture(tribeCultureOutput, visible);
  if (tribes.length > MAX_RENDERED_TRIBES) {
    const note = document.createElement('p');
    note.textContent = `Affichage limite a ${MAX_RENDERED_TRIBES} tribus sur ${tribes.length} (perf).`;
    tribeCultureOutput.appendChild(note);
  }
}

function renderEnvironmentInfo(state, stats) {
  const season = state?.environmentState?.seasonState;
  const climate = state?.environmentState?.globalClimateState;
  const activeEvents = state?.activeEvents ?? [];
  seasonOutput.textContent = `Saison: ${season?.seasonName ?? 'spring'} | Annee: ${season?.year ?? 0} | Jour: ${season?.dayInYear ?? 0}`;
  climateOutput.textContent = `Climat global -> tempShift: ${(climate?.globalTempShift ?? 0).toFixed(3)} | humidityShift: ${(climate?.globalHumidityShift ?? 0).toFixed(3)}`;
  if (activeEvents.length) {
    const preview = activeEvents
      .slice(0, 3)
      .map((e) => `${e.type}@(${e.x},${e.y}) r${e.radius} i${e.intensity.toFixed(2)} t${e.remainingTicks}`)
      .join(' | ');
    const more = activeEvents.length > 3 ? ` | +${activeEvents.length - 3} autres` : '';
    eventsOutput.textContent = `Events actifs (${activeEvents.length}) : ${preview}${more}`;
  } else {
    eventsOutput.textContent = `Events actifs: 0${stats ? ` | intensite moyenne: ${(stats.meanEventIntensity ?? 0).toFixed(2)}` : ''}`;
  }
}

function applyLoadedState(loaded) {
  currentWorld = loaded.world;
  currentAgents = loaded.agents;
  currentSimulationState = loaded.state;
  currentTribes = loaded.state.tribes ?? [];
  currentInteractionEvents = [];
  tick = loaded.tick;
  seedInput.value = loaded.seed;

  chartStore.reset();
  renderer.render(currentWorld, currentAgents, currentTribes, currentInteractionEvents, currentSimulationState.activeEvents ?? []);
  renderPopulation(populationOutput, { population: currentAgents.length, births: 0, deaths: 0 });
  renderTribeStats(tribeStatsOutput, { tribes: currentTribes.length, averageTribeSize: 0, dissolvedTribes: 0 });
  renderTribeCulturePanel(currentTribes);
  renderEnvironmentInfo(currentSimulationState);
  updateTickLabel();
}

function manualSave() {
  if (!currentWorld) return;
  const data = readStorage(currentWorld.seed);
  data.saves.unshift({ savedAt: Date.now(), tick, payload: savePayload() });
  data.saves = data.saves.slice(0, 20);
  writeStorage(currentWorld.seed, data);
  refreshSnapshotDropdown(currentWorld.seed);
  setStatus('Save effectué avec succès.');
}

function manualLoad() {
  if (!currentWorld) return;
  const data = readStorage(currentWorld.seed);
  if (!data.saves.length) return setStatus('Aucune sauvegarde disponible pour cette seed.');
  applyLoadedState(deserializeAll(data.saves[0].payload));
  setStatus('Load effectué avec succès.');
}

function autoSnapshot() {
  if (!currentWorld || tick === 0 || tick % SNAPSHOT_EVERY !== 0) return;
  const data = readStorage(currentWorld.seed);
  data.snapshots.unshift({ savedAt: Date.now(), tick, payload: savePayload() });
  data.snapshots = data.snapshots.slice(0, MAX_SNAPSHOTS);
  writeStorage(currentWorld.seed, data);
  refreshSnapshotDropdown(currentWorld.seed);
}

function loadSelectedSnapshot() {
  if (!currentWorld) return;
  const data = readStorage(currentWorld.seed);
  const entry = data.snapshots[Number(snapshotSelect.value)];
  if (!entry) return setStatus('Snapshot introuvable.');
  applyLoadedState(deserializeAll(entry.payload));
  setStatus(`Replay chargé depuis tick ${entry.tick}.`);
}

function buildSimulation(seed) {
  currentWorld = generateWorldMap({ width: WORLD_SIZE, height: WORLD_SIZE, seed });
  currentAgents = spawnInitialAgents(currentWorld, INITIAL_AGENTS, seed);
  currentTribes = [];
  currentInteractionEvents = [];
  currentSimulationState = createInitialSimulationState();
  tick = 0;
  chartStore.reset();

  renderer.render(currentWorld, currentAgents, currentTribes, currentInteractionEvents, currentSimulationState.activeEvents ?? []);
  testsOutput.innerHTML = '<li>Tests desactives dans l\'UI (perf)</li>';
  renderPopulation(populationOutput, { population: currentAgents.length, births: 0, deaths: 0 });
  renderTribeStats(tribeStatsOutput, { tribes: 0, averageTribeSize: 0, dissolvedTribes: 0 });
  renderGlobalCulture(cultureAverageOutput, { tech: 0, war: 0, education: 0, trade: 0, ecology: 0, spirituality: 0 });
  renderInteractionStats(interactionOutput, { interactionsThisTick: 0, interactionBreakdown: { trade: 0, cooperate: 0, betray: 0, attack: 0, avoid: 0 }, meanTrustScore: 0 });
  renderBeliefStats(beliefOutput, { totalBeliefs: 0, topBeliefs: [] });
  renderTechnologyStats(technologyOutput, { meanGlobalTechLevel: 0, totalTechLevels: 0, techLevelDistribution: {} });
  renderTribeCulturePanel([]);
  chartsRenderer.render(chartStore.series);
  renderEnvironmentInfo(currentSimulationState);

  refreshSnapshotDropdown(seed);
  updateTickLabel();
  setStatus('Simulation initialisée.');
}

function stepSimulation() {
  tick += 1;
  const result = tickSimulation(currentWorld, currentAgents, tick, currentWorld.seed, currentSimulationState);
  currentWorld = result.world;
  currentAgents = result.agents;
  currentTribes = result.tribes;
  currentInteractionEvents = result.interactionEvents ?? [];
  currentSimulationState = result.simulationState;

  chartStore.addPoint(tick, result.stats);
  if (shouldRenderFullUi(tick)) {
    renderer.render(currentWorld, currentAgents, currentTribes, currentInteractionEvents, currentSimulationState.activeEvents ?? []);
    renderPopulation(populationOutput, result.stats);
    renderTribeStats(tribeStatsOutput, result.stats);
    renderGlobalCulture(cultureAverageOutput, result.stats.cultureAverage ?? {});
    renderInteractionStats(interactionOutput, result.stats);
    renderBeliefStats(beliefOutput, result.stats);
    renderTechnologyStats(technologyOutput, result.stats);
    renderTribeCulturePanel(currentTribes);
    chartsRenderer.render(chartStore.series);
    renderEnvironmentInfo(currentSimulationState, result.stats);
  }
  updateTickLabel();
  autoSnapshot();
}

function startLoop() {
  if (simulationTimer) clearInterval(simulationTimer);
  simulationTimer = setInterval(() => {
    if (!currentWorld) return;
    stepSimulation();
  }, SIMULATION_INTERVAL_MS);
}

function runExperimentsUI() {
  const runs = Math.max(1, Number(runsInput.value) || 1);
  const ticksPerRun = Math.max(10, Number(ticksPerRunInput.value) || 100);
  const output = runExperiments({ runs, ticksPerRun, baseSeed: seedInput.value.trim() || 'phase9-exp' });
  experimentsOutput.textContent = [
    `Runs: ${output.runs}, Ticks/run: ${output.ticksPerRun}`,
    `Population finale -> mean:${output.summary.population.mean.toFixed(2)} var:${output.summary.population.variance.toFixed(2)} min:${output.summary.population.min} max:${output.summary.population.max}`,
    `Tribus finales -> mean:${output.summary.tribes.mean.toFixed(2)} var:${output.summary.tribes.variance.toFixed(2)} min:${output.summary.tribes.min} max:${output.summary.tribes.max}`,
    `Tech moyenne finale -> mean:${output.summary.tech.mean.toFixed(2)} var:${output.summary.tech.variance.toFixed(2)} min:${output.summary.tech.min.toFixed(2)} max:${output.summary.tech.max.toFixed(2)}`,
    `Croyances finales -> mean:${output.summary.beliefs.mean.toFixed(2)} var:${output.summary.beliefs.variance.toFixed(2)} min:${output.summary.beliefs.min} max:${output.summary.beliefs.max}`,
  ].join('\n');
}

generateButton.addEventListener('click', () => {
  const seed = seedInput.value.trim() || 'default-seed';
  buildSimulation(seed);
  startLoop();
});
saveButton.addEventListener('click', manualSave);
loadButton.addEventListener('click', manualLoad);
loadSnapshotButton.addEventListener('click', loadSelectedSnapshot);
runExperimentsButton.addEventListener('click', runExperimentsUI);

buildSimulation(seedInput.value.trim() || 'phase9-demo');
startLoop();

