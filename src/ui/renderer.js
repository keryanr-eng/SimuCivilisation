import { BIOME_COLORS } from '../engine/biomes.js';

const TRIBE_PALETTE = ['#ffffff', '#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#c77dff', '#f28482', '#90be6d'];

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

export function createWorldRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Impossible de créer le contexte 2D du canvas.');
  }

  function render(world, agents = [], tribes = []) {
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
