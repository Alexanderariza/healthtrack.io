import '../vendor/chart.js/chart.umd.min.js';

const chartInstances = new Map();

function formatShortDate(iso) {
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(iso));
}

function buildTargetDataset(label, targetValue, length, color) {
  if (!Number.isFinite(Number(targetValue))) return null;
  return {
    label,
    data: Array(length).fill(Number(targetValue)),
    borderColor: color,
    borderDash: [6, 6],
    borderWidth: 1.5,
    pointRadius: 0,
    fill: false
  };
}

export function renderLineChart(canvasId, datasetsSpec, targetSpec = null) {
  const ChartGlobal = window.Chart;
  const canvas = document.getElementById(canvasId);
  if (!canvas || !ChartGlobal) return null;

  if (chartInstances.has(canvasId)) {
    chartInstances.get(canvasId).destroy();
    chartInstances.delete(canvasId);
  }

  const primarySeries = (datasetsSpec[0] && datasetsSpec[0].points) || [];
  const labels = primarySeries.map((p) => formatShortDate(p.timestamp));

  const datasets = datasetsSpec.map((ds) => ({
    label: ds.label,
    data: ds.points.map((p) => p.value),
    borderColor: ds.color,
    backgroundColor: ds.color,
    tension: 0.25,
    pointRadius: 3.5,
    borderWidth: 2,
    fill: false
  }));

  if (targetSpec && Number.isFinite(Number(targetSpec.value)) && labels.length > 0) {
    const targetDs = buildTargetDataset(targetSpec.label || 'Objetivo', targetSpec.value, labels.length, '#c45a11');
    if (targetDs) datasets.push(targetDs);
  }

  const instance = new ChartGlobal(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { position: 'top' }
      },
      scales: {
        x: { ticks: { maxTicksLimit: 6 } }
      }
    }
  });

  chartInstances.set(canvasId, instance);
  return instance;
}

export function getChartImageDataUrls() {
  const images = [];
  for (const [id, chart] of chartInstances.entries()) {
    if (id.startsWith('chart-ind-') && typeof chart.toBase64Image === 'function') {
      images.push({
        id,
        title: chart.data.datasets[0]?.label || id,
        dataUrl: chart.toBase64Image('image/png', 1)
      });
    }
  }
  return images;
}