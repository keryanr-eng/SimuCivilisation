function downsample(points, maxPoints = 2000) {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const sampled = [];
  for (let i = 0; i < points.length; i += step) sampled.push(points[i]);
  return sampled;
}

function makeSeries() {
  return {
    tick: [],
    population: [],
    tribes: [],
    tech: [],
    beliefs: [],
    tradeCum: [],
    attackCum: [],
    eventsCount: [],
    eventsIntensity: [],
  };
}

export function createChartStore(maxPoints = 2000) {
  const series = makeSeries();
  let tradeTotal = 0;
  let attackTotal = 0;

  function reset() {
    Object.assign(series, makeSeries());
    tradeTotal = 0;
    attackTotal = 0;
  }

  function addPoint(tick, stats) {
    tradeTotal += stats?.interactionBreakdown?.trade ?? 0;
    attackTotal += stats?.interactionBreakdown?.attack ?? 0;

    series.tick.push(tick);
    series.population.push(stats?.population ?? 0);
    series.tribes.push(stats?.tribes ?? 0);
    series.tech.push(stats?.meanGlobalTechLevel ?? 0);
    series.beliefs.push(stats?.totalBeliefs ?? 0);
    series.tradeCum.push(tradeTotal);
    series.attackCum.push(attackTotal);
    series.eventsCount.push(stats?.activeEventsCount ?? 0);
    series.eventsIntensity.push(stats?.meanEventIntensity ?? 0);

    Object.keys(series).forEach((key) => {
      series[key] = downsample(series[key], maxPoints);
    });
  }

  return { series, reset, addPoint };
}

function drawLineChart(ctx, width, height, valuesA, valuesB, colorA, colorB, title) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#10141c';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#cdd6f4';
  ctx.font = '12px sans-serif';
  ctx.fillText(title, 8, 14);

  const values = valuesA.concat(valuesB ?? []);
  const maxV = Math.max(1, ...values);

  function draw(valuesSet, color) {
    if (!valuesSet.length) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    valuesSet.forEach((v, i) => {
      const x = (i / Math.max(1, valuesSet.length - 1)) * (width - 20) + 10;
      const y = height - 10 - (v / maxV) * (height - 24);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  draw(valuesA, colorA);
  if (valuesB) draw(valuesB, colorB);
}

export function createChartsRenderer({ popCanvas, tribeCanvas, techCanvas, beliefCanvas, interactionCanvas, eventsCanvas }) {
  const popCtx = popCanvas.getContext('2d');
  const tribeCtx = tribeCanvas.getContext('2d');
  const techCtx = techCanvas.getContext('2d');
  const beliefCtx = beliefCanvas.getContext('2d');
  const interactionCtx = interactionCanvas.getContext('2d');
  const eventsCtx = eventsCanvas.getContext('2d');

  function render(series) {
    drawLineChart(popCtx, popCanvas.width, popCanvas.height, series.population, null, '#8be9fd', null, 'Population');
    drawLineChart(tribeCtx, tribeCanvas.width, tribeCanvas.height, series.tribes, null, '#f1fa8c', null, 'Nombre de tribus');
    drawLineChart(techCtx, techCanvas.width, techCanvas.height, series.tech, null, '#50fa7b', null, 'Technologie moyenne');
    drawLineChart(beliefCtx, beliefCanvas.width, beliefCanvas.height, series.beliefs, null, '#ff79c6', null, 'Nombre de croyances');
    drawLineChart(interactionCtx, interactionCanvas.width, interactionCanvas.height, series.tradeCum, series.attackCum, '#6bc46d', '#ff5d5d', 'Interactions cumulées trade/attack');
    drawLineChart(eventsCtx, eventsCanvas.width, eventsCanvas.height, series.eventsCount, series.eventsIntensity, '#ffa657', '#9ccfd8', 'Events actifs / intensité moyenne');
  }

  return { render };
}
