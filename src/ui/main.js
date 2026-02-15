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

function ensurePauseResumeButton() {
  const existing = document.getElementById('pauseResumeButton');
  if (existing) return existing;
  const button = document.createElement('button');
  button.id = 'pauseResumeButton';
  button.type = 'button';
  button.textContent = 'Arreter simulation';
  generateButton?.insertAdjacentElement('afterend', button);
  return button;
}

const pauseResumeButton = ensurePauseResumeButton();
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
let isPaused = false;
let isRunningExperiments = false;

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
function updatePauseResumeButton() {
  if (!pauseResumeButton) return;
  pauseResumeButton.textContent = isPaused ? 'Reprendre simulation' : 'Arreter simulation';
  pauseResumeButton.disabled = isRunningExperiments;
}

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
  isPaused = false;
  updatePauseResumeButton();
}

function stopLoop() {
  if (!simulationTimer) return;
  clearInterval(simulationTimer);
  simulationTimer = null;
  isPaused = true;
  updatePauseResumeButton();
}

function toggleLoop() {
  if (isRunningExperiments) return;
  if (simulationTimer) {
    stopLoop();
    setStatus('Simulation en pause.');
  } else {
    startLoop();
    setStatus('Simulation relancee.');
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatFloat(value, digits = 2) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return '-';
  return num.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatInt(value) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return '-';
  return Math.round(num).toLocaleString('fr-FR');
}

function stdDev(variance) {
  const safeVariance = Number(variance ?? 0);
  return Math.sqrt(Math.max(0, safeVariance));
}

function stabilityLevel(summary) {
  const mean = Math.abs(Number(summary?.mean ?? 0));
  if (mean <= 1e-9) return 'Stable';
  const cv = stdDev(summary?.variance) / mean;
  if (cv < 0.15) return 'Stable';
  if (cv < 0.35) return 'Moderee';
  return 'Volatile';
}

function formatSummaryValue(summary, key) {
  if (key === 'population' || key === 'tribes') return formatInt(summary.mean);
  return formatFloat(summary.mean, 2);
}

function formatSummaryMinMax(summary, key, field) {
  if (key === 'population' || key === 'tribes') return formatInt(summary[field]);
  return formatFloat(summary[field], 2);
}

function computeHistogram(values, desiredBins = 8) {
  if (!values.length) return { min: 0, max: 1, counts: [0], edges: [0, 1] };
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (Math.abs(max - min) < 1e-9) {
    return { min, max, counts: [values.length], edges: [min - 0.5, max + 0.5] };
  }

  const bins = Math.max(4, Math.min(10, desiredBins));
  const width = (max - min) / bins;
  const counts = new Array(bins).fill(0);
  const edges = new Array(bins + 1).fill(0).map((_, i) => min + i * width);

  values.forEach((value) => {
    const rawIndex = Math.floor((value - min) / width);
    const index = Math.max(0, Math.min(bins - 1, rawIndex));
    counts[index] += 1;
  });

  return { min, max, counts, edges };
}

function drawHistogramChart(canvas, values, title, color) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = canvas.width;
  const height = canvas.height;
  const left = 34;
  const right = 10;
  const top = 20;
  const bottom = 22;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  const hist = computeHistogram(values, Math.round(Math.sqrt(Math.max(4, values.length))));
  const maxCount = Math.max(1, ...hist.counts);
  const barStep = plotWidth / Math.max(1, hist.counts.length);
  const barWidth = barStep * 0.72;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0e1320';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#243149';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = top + (plotHeight * i) / 4;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
  }

  ctx.fillStyle = color;
  hist.counts.forEach((count, index) => {
    const ratio = count / maxCount;
    const h = Math.max(1, Math.round(plotHeight * ratio));
    const x = left + index * barStep + (barStep - barWidth) / 2;
    const y = top + plotHeight - h;
    ctx.fillRect(x, y, barWidth, h);
  });

  ctx.fillStyle = '#d8e4ff';
  ctx.font = '12px sans-serif';
  ctx.fillText(title, 8, 14);

  ctx.fillStyle = '#98a9c8';
  ctx.font = '10px sans-serif';
  ctx.fillText('runs', 6, top + 8);
  ctx.fillText(String(maxCount), 6, top + 3);
  ctx.fillText('0', 14, top + plotHeight + 3);
  ctx.fillText(formatInt(hist.min), left, height - 6);
  ctx.fillText(formatInt((hist.min + hist.max) / 2), left + plotWidth / 2 - 8, height - 6);
  ctx.fillText(formatInt(hist.max), left + plotWidth - 16, height - 6);
}

function drawLineChart(canvas, values, title, color, forceZeroMin = true) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = canvas.width;
  const height = canvas.height;
  const left = 34;
  const right = 10;
  const top = 20;
  const bottom = 22;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  const safeValues = values.length ? values : [0];
  let minV = Math.min(...safeValues);
  let maxV = Math.max(...safeValues);
  if (forceZeroMin) minV = Math.min(0, minV);
  if (Math.abs(maxV - minV) < 1e-9) {
    maxV += 1;
    minV -= 1;
  }

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0e1320';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#243149';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = top + (plotHeight * i) / 4;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  safeValues.forEach((value, index) => {
    const x = left + (plotWidth * index) / Math.max(1, safeValues.length - 1);
    const normalized = (value - minV) / (maxV - minV);
    const y = top + (1 - normalized) * plotHeight;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = '#d8e4ff';
  ctx.font = '12px sans-serif';
  ctx.fillText(title, 8, 14);

  ctx.fillStyle = '#98a9c8';
  ctx.font = '10px sans-serif';
  ctx.fillText(`run 1`, left, height - 6);
  ctx.fillText(`run ${safeValues.length}`, left + plotWidth - 36, height - 6);
  ctx.fillText(formatFloat(maxV, 2), 4, top + 4);
  ctx.fillText(formatFloat(minV, 2), 4, top + plotHeight + 3);
}

function renderExperimentsReport(output, elapsedSeconds) {
  const metrics = [
    { key: 'population', label: 'Population finale' },
    { key: 'tribes', label: 'Tribus finales' },
    { key: 'tech', label: 'Tech moyenne finale' },
    { key: 'beliefs', label: 'Croyances finales' },
    { key: 'trust', label: 'Confiance moyenne' },
  ];

  const metricRows = metrics.map((metric) => {
    const summary = output.summary[metric.key] ?? { mean: 0, variance: 0, min: 0, max: 0 };
    return `
      <tr>
        <td>${escapeHtml(metric.label)}</td>
        <td>${formatSummaryValue(summary, metric.key)}</td>
        <td>${formatFloat(stdDev(summary.variance), 2)}</td>
        <td>${formatSummaryMinMax(summary, metric.key, 'min')}</td>
        <td>${formatSummaryMinMax(summary, metric.key, 'max')}</td>
        <td><span class="report-badge">${stabilityLevel(summary)}</span></td>
      </tr>
    `;
  }).join('');

  const previewRuns = output.records;
  const runsRows = previewRuns.map((record, index) => `
    <tr>
      <td>#${index + 1}</td>
      <td>${formatInt(record.finalPopulation)}</td>
      <td>${formatInt(record.finalTribes)}</td>
      <td>${formatFloat(record.meanTech, 2)}</td>
      <td>${formatFloat(record.totalBeliefs, 2)}</td>
      <td>${formatFloat(record.meanTrust, 2)}</td>
    </tr>
  `).join('');

  const maxPopulationRun = output.records.reduce((best, current) => (
    !best || current.finalPopulation > best.finalPopulation ? current : best
  ), null);
  const minPopulationRun = output.records.reduce((best, current) => (
    !best || current.finalPopulation < best.finalPopulation ? current : best
  ), null);

  const generatedAt = new Date().toLocaleTimeString('fr-FR');
  const meanPopulation = output.summary.population?.mean ?? 0;
  const meanTribes = output.summary.tribes?.mean ?? 0;

  experimentsOutput.innerHTML = `
    <h3 class="report-title">Rapport Multi-run</h3>
    <div class="report-grid">
      <div class="report-kpi"><span class="report-kpi-label">Runs</span><span class="report-kpi-value">${formatInt(output.runs)}</span></div>
      <div class="report-kpi"><span class="report-kpi-label">Ticks / run</span><span class="report-kpi-value">${formatInt(output.ticksPerRun)}</span></div>
      <div class="report-kpi"><span class="report-kpi-label">Duree</span><span class="report-kpi-value">${formatFloat(elapsedSeconds, 2)} s</span></div>
    </div>
    <table class="report-table">
      <thead>
        <tr>
          <th>Metrique</th>
          <th>Moyenne</th>
          <th>Ecart-type</th>
          <th>Min</th>
          <th>Max</th>
          <th>Stabilite</th>
        </tr>
      </thead>
      <tbody>${metricRows}</tbody>
    </table>
    <p class="report-muted">
      Lecture rapide: apres ${formatInt(output.ticksPerRun)} ticks, une simulation termine en moyenne a ${formatInt(meanPopulation)} agents et ${formatFloat(meanTribes, 2)} tribus.
      Maj: ${escapeHtml(generatedAt)}.
    </p>
    <p class="report-muted">
      Meilleure population observee: ${formatInt(maxPopulationRun?.finalPopulation ?? 0)}. Plus faible: ${formatInt(minPopulationRun?.finalPopulation ?? 0)}.
    </p>
    <div class="report-charts">
      <figure class="report-chart-card">
        <figcaption class="report-chart-title">Distribution population finale</figcaption>
        <canvas id="expPopHistCanvas" class="report-chart-canvas" width="420" height="190"></canvas>
        <p class="report-chart-legend">Axe X: classes de population finale | Axe Y: nombre de runs dans chaque classe.</p>
      </figure>
      <figure class="report-chart-card">
        <figcaption class="report-chart-title">Distribution tribus finales</figcaption>
        <canvas id="expTribeHistCanvas" class="report-chart-canvas" width="420" height="190"></canvas>
        <p class="report-chart-legend">Axe X: classes de nombre de tribus | Axe Y: nombre de runs.</p>
      </figure>
      <figure class="report-chart-card">
        <figcaption class="report-chart-title">Tech moyenne finale par run</figcaption>
        <canvas id="expTechRunCanvas" class="report-chart-canvas" width="420" height="190"></canvas>
        <p class="report-chart-legend">Axe X: index du run | Axe Y: tech moyenne finale de ce run.</p>
      </figure>
      <figure class="report-chart-card">
        <figcaption class="report-chart-title">Confiance moyenne finale par run</figcaption>
        <canvas id="expTrustRunCanvas" class="report-chart-canvas" width="420" height="190"></canvas>
        <p class="report-chart-legend">Axe X: index du run | Axe Y: confiance moyenne finale (peut etre negative).</p>
      </figure>
    </div>
    <details class="report-details">
      <summary>Detail run par run (${formatInt(output.records.length)} lignes)</summary>
      <table class="report-table">
        <thead>
          <tr>
            <th>Run</th>
            <th>Population</th>
            <th>Tribus</th>
            <th>Tech</th>
            <th>Croyances</th>
            <th>Confiance</th>
          </tr>
        </thead>
        <tbody>${runsRows}</tbody>
      </table>
    </details>
  `;

  const populationValues = output.records.map((record) => record.finalPopulation ?? 0);
  const tribeValues = output.records.map((record) => record.finalTribes ?? 0);
  const techValues = output.records.map((record) => record.meanTech ?? 0);
  const trustValues = output.records.map((record) => record.meanTrust ?? 0);

  drawHistogramChart(document.getElementById('expPopHistCanvas'), populationValues, 'Population finale', '#60a5fa');
  drawHistogramChart(document.getElementById('expTribeHistCanvas'), tribeValues, 'Tribus finales', '#f59e0b');
  drawLineChart(document.getElementById('expTechRunCanvas'), techValues, 'Tech moyenne finale', '#34d399', true);
  drawLineChart(document.getElementById('expTrustRunCanvas'), trustValues, 'Confiance moyenne finale', '#f472b6', false);
}

function runExperimentsUI() {
  if (isRunningExperiments) return;
  const runs = Math.max(1, Number(runsInput.value) || 1);
  const ticksPerRun = Math.max(10, Number(ticksPerRunInput.value) || 100);
  const wasRunning = Boolean(simulationTimer);
  if (wasRunning) stopLoop();

  isRunningExperiments = true;
  runExperimentsButton.disabled = true;
  runExperimentsButton.textContent = 'Running...';
  updatePauseResumeButton();
  experimentsOutput.innerHTML = `<div class="report-loading"><strong>Calcul en cours...</strong><br/>Runs: ${formatInt(runs)} | Ticks/run: ${formatInt(ticksPerRun)}</div>`;
  setStatus('Experiments en cours...');

  window.setTimeout(() => {
    try {
      const startedAt = performance.now();
      const output = runExperiments({ runs, ticksPerRun, baseSeed: seedInput.value.trim() || 'phase9-exp' });
      const elapsedSeconds = (performance.now() - startedAt) / 1000;
      renderExperimentsReport(output, elapsedSeconds);
      setStatus('Experiments termines.');
    } catch (error) {
      experimentsOutput.innerHTML = `<div class="report-loading">Erreur experiments: ${escapeHtml(error?.message ?? String(error))}</div>`;
      setStatus('Erreur pendant experiments.');
    } finally {
      isRunningExperiments = false;
      runExperimentsButton.disabled = false;
      runExperimentsButton.textContent = 'Run experiments';
      if (wasRunning) startLoop();
      updatePauseResumeButton();
    }
  }, 0);
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
pauseResumeButton?.addEventListener('click', toggleLoop);

buildSimulation(seedInput.value.trim() || 'phase9-demo');
startLoop();

