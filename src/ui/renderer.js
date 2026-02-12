import { BIOME_COLORS } from '../engine/biomes.js';

const TRIBE_PALETTE = ['#ffffff', '#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#c77dff', '#f28482', '#90be6d'];
const CULTURE_KEYS = ['tech', 'war', 'education', 'trade', 'ecology', 'spirituality'];

const INTERACTION_COLORS = {
  trade: '#62d26f',
  cooperate: '#57c7ff',
  betray: '#f6b93b',
  attack: '#ff5d5d',
  avoid: '#9aa5b1',
  mixed: '#c77dff',
};

const EVENT_COLORS = { drought: 'rgba(255,193,7,0.28)', flood: 'rgba(86,156,214,0.28)', wildfire: 'rgba(255,90,90,0.28)', coldSnap: 'rgba(173,216,230,0.28)', resourceBloom: 'rgba(98,210,111,0.28)' };

function colorForTribe(tribeId) {
  let hash = 0;
  for (let i = 0; i < tribeId.length; i += 1) {
    hash = (hash * 31 + tribeId.charCodeAt(i)) >>> 0;
  }
  const index = 1 + (hash % (TRIBE_PALETTE.length - 1));
  return TRIBE_PALETTE[index];
}

function drawAgentDot(imageData, width, x, y, colorHex) {
  const safeX = Math.max(0, Math.min(width - 1, x));
  const safeY = Math.max(0, Math.min((imageData.height ?? width) - 1, y));
  const index = (safeY * width + safeX) * 4;
  imageData.data[index] = Number.parseInt(colorHex.slice(1, 3), 16);
  imageData.data[index + 1] = Number.parseInt(colorHex.slice(3, 5), 16);
  imageData.data[index + 2] = Number.parseInt(colorHex.slice(5, 7), 16);
  imageData.data[index + 3] = 255;
}

function mapAgentToTribe(tribes) {
  const map = new Map();
  tribes.forEach((tribe) => {
    tribe.members.forEach((memberId) => map.set(memberId, tribe.id));
  });
  return map;
}

function dominantCulture(culture) {
  let bestKey = CULTURE_KEYS[0];
  let bestValue = culture[bestKey];
  CULTURE_KEYS.forEach((key) => {
    if (culture[key] > bestValue) {
      bestKey = key;
      bestValue = culture[key];
    }
  });
  return bestKey;
}


function drawEventZones(ctx, activeEvents = []) {
  activeEvents.forEach((event) => {
    ctx.strokeStyle = EVENT_COLORS[event.type] ?? 'rgba(255,255,255,0.2)';
    ctx.fillStyle = EVENT_COLORS[event.type] ?? 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(event.x + 0.5, event.y + 0.5, Math.max(2, event.radius), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
}

function drawInteractionLines(ctx, interactionEvents) {
  interactionEvents.forEach((event) => {
    const same = event.actionA === event.actionB;
    const key = same ? event.actionA : 'mixed';
    ctx.strokeStyle = INTERACTION_COLORS[key] ?? INTERACTION_COLORS.mixed;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(event.from.x + 0.5, event.from.y + 0.5);
    ctx.lineTo(event.to.x + 0.5, event.to.y + 0.5);
    ctx.stroke();
  });
}

function formatTechEffects(effects = {}) {
  return `eff:${(effects.efficiencyBonus ?? 0).toFixed(2)} | storage:${(effects.storageBonus ?? 0).toFixed(2)} | move:${(effects.movementBonus ?? 0).toFixed(2)} | def:${(effects.defenseBonus ?? 0).toFixed(2)} | trade:${(effects.tradeBonus ?? 0).toFixed(2)}`;
}

export function createWorldRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Impossible de créer le contexte 2D du canvas.');
  }

  function render(world, agents = [], tribes = [], interactionEvents = [], activeEvents = []) {
    const imageData = ctx.createImageData(world.width, world.height);
    const { data } = imageData;

    for (let i = 0; i < world.tiles.length; i += 1) {
      const tile = world.tiles[i];
      const color = BIOME_COLORS[tile.biome] ?? '#ff00ff';
      const r = Number.parseInt(color.slice(1, 3), 16);
      const g = Number.parseInt(color.slice(3, 5), 16);
      const b = Number.parseInt(color.slice(5, 7), 16);

      const p = i * 4;
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = 255;
    }

    const tribeByAgent = mapAgentToTribe(tribes);
    agents.forEach((agent) => {
      const tribeId = tribeByAgent.get(agent.id);
      const color = tribeId ? colorForTribe(tribeId) : '#ffffff';
      drawAgentDot(imageData, world.width, Math.round(agent.x), Math.round(agent.y), color);
    });

    ctx.putImageData(imageData, 0, 0);
    drawEventZones(ctx, activeEvents);
    drawInteractionLines(ctx, interactionEvents);
  }

  return { render };
}

export function renderLegend(container) {
  container.innerHTML = '';
  Object.entries(BIOME_COLORS).forEach(([biome, color]) => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `<span class="swatch" style="background:${color}"></span><span>${biome}</span>`;
    container.appendChild(item);
  });

  const freeAgentItem = document.createElement('div');
  freeAgentItem.className = 'legend-item';
  freeAgentItem.innerHTML = '<span class="swatch" style="background:#ffffff"></span><span>agent sans tribu</span>';
  container.appendChild(freeAgentItem);

  const tribeItem = document.createElement('div');
  tribeItem.className = 'legend-item';
  tribeItem.innerHTML = '<span class="swatch" style="background:#ff6b6b"></span><span>agent en tribu</span>';
  container.appendChild(tribeItem);
}

export function renderTests(container, tests) {
  container.innerHTML = '';
  tests.forEach((test) => {
    const li = document.createElement('li');
    li.className = test.passed ? 'ok' : 'ko';
    li.textContent = `${test.passed ? '✅' : '❌'} ${test.name} — ${test.detail}`;
    container.appendChild(li);
  });
}

export function renderPopulation(container, stats) {
  container.textContent = `Population: ${stats.population} | Naissances tick: ${stats.births} | Morts tick: ${stats.deaths}`;
}

export function renderTribeStats(container, stats) {
  container.textContent = `Tribus: ${stats.tribes} | Taille moyenne: ${stats.averageTribeSize.toFixed(2)} | Dissoutes tick: ${stats.dissolvedTribes}`;
}

export function renderGlobalCulture(container, cultureAverage) {
  const parts = CULTURE_KEYS.map((key) => `${key}: ${(cultureAverage[key] ?? 0).toFixed(2)}`);
  container.textContent = `Moyenne culturelle globale → ${parts.join(' | ')}`;
}

export function renderInteractionStats(container, stats) {
  const breakdown = stats.interactionBreakdown ?? { trade: 0, cooperate: 0, betray: 0, attack: 0, avoid: 0 };
  container.textContent = `Interactions tick: ${stats.interactionsThisTick ?? 0} | trade: ${breakdown.trade} | cooperate: ${breakdown.cooperate} | betray: ${breakdown.betray} | attack: ${breakdown.attack} | avoid: ${breakdown.avoid} | trust moyen: ${(stats.meanTrustScore ?? 0).toFixed(2)}`;
}

export function renderBeliefStats(container, stats) {
  const top = (stats.topBeliefs ?? []).map((item) => `${item.trigger} (${item.strength.toFixed(2)})`).join(' | ');
  container.textContent = `Croyances actives: ${stats.totalBeliefs ?? 0}${top ? ` | Top: ${top}` : ''}`;
}

export function renderTechnologyStats(container, stats) {
  const distribution = Object.entries(stats.techLevelDistribution ?? {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([level, count]) => `L${level}:${count}`)
    .join(' | ');
  container.textContent = `Tech moyenne: ${(stats.meanGlobalTechLevel ?? 0).toFixed(2)} | Niveaux cumulés: ${stats.totalTechLevels ?? 0}${distribution ? ` | Distribution: ${distribution}` : ''}`;
}

export function renderTribeCulture(container, tribes) {
  container.innerHTML = '';

  if (!tribes.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Aucune tribu active pour le moment.';
    container.appendChild(empty);
    return;
  }

  tribes.forEach((tribe) => {
    const card = document.createElement('article');
    card.className = 'tribe-card';

    const title = document.createElement('h3');
    title.textContent = `${tribe.id} (${tribe.members.length} membres) · dominante: ${dominantCulture(tribe.culture)}`;
    card.appendChild(title);

    CULTURE_KEYS.forEach((key) => {
      const row = document.createElement('div');
      row.className = 'culture-row';
      row.innerHTML = `
        <span class="culture-key">${key}</span>
        <div class="culture-bar-track"><div class="culture-bar-fill" style="width:${Math.round((tribe.culture[key] ?? 0) * 100)}%"></div></div>
        <span class="culture-value">${(tribe.culture[key] ?? 0).toFixed(2)}</span>
      `;
      card.appendChild(row);
    });

    const beliefs = document.createElement('p');
    const beliefText = (tribe.beliefs ?? []).map((belief) => `${belief.trigger}:${belief.strength.toFixed(2)}`).join(' | ');
    beliefs.className = 'belief-line';
    beliefs.textContent = beliefText ? `Croyances → ${beliefText}` : 'Croyances → aucune';
    card.appendChild(beliefs);

    const tech = document.createElement('p');
    tech.className = 'belief-line';
    const firstTech = Object.values(tribe.technologies ?? {})[0];
    const progress = firstTech ? `${firstTech.progress.toFixed(2)} / ${firstTech.cost.toFixed(2)}` : '0 / 0';
    tech.textContent = `Tech → globalLevel:${tribe.globalTechLevel ?? 0} | rate:${(tribe.techProgressRate ?? 0).toFixed(3)} | progress:${progress}`;
    card.appendChild(tech);

    const techEffects = document.createElement('p');
    techEffects.className = 'belief-line';
    techEffects.textContent = `Effets tech → ${formatTechEffects(tribe.techActiveEffects ?? {})}`;
    card.appendChild(techEffects);

    container.appendChild(card);
  });
}
