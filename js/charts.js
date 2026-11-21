const chartInstances = new Map();

function formatShortDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

function drawChart(canvas, datasetsSpec, targetSpec) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(320, canvas.clientWidth || 640);
  const height = Math.max(220, canvas.clientHeight || 260);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const allValues = datasetsSpec.flatMap(ds => (ds.points || []).map(p => Number(p.value)).filter(Number.isFinite));
  if (!allValues.length) {
    ctx.fillStyle = '#64748b';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Sin datos para representar', width / 2, height / 2);
    return;
  }

  let min = Math.min(...allValues);
  let max = Math.max(...allValues);
  if (targetSpec && Number.isFinite(Number(targetSpec.value))) {
    min = Math.min(min, Number(targetSpec.value));
    max = Math.max(max, Number(targetSpec.value));
  }
  const pad = Math.max(5, (max - min) * 0.15);
  min = Math.floor(min - pad);
  max = Math.ceil(max + pad);
  if (min === max) max = min + 1;

  const left = 48, right = 14, top = 18, bottom = 42;
  const plotW = width - left - right, plotH = height - top - bottom;
  const xCount = Math.max(...datasetsSpec.map(ds => (ds.points || []).length), 1);
  const x = i => left + (xCount <= 1 ? plotW / 2 : i * plotW / (xCount - 1));
  const y = v => top + (max - v) * plotH / (max - min);

  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#e2e8f0';
  ctx.fillStyle = '#64748b';
  for (let i = 0; i <= 4; i++) {
    const value = min + (max - min) * i / 4;
    const yy = y(value);
    ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(width - right, yy); ctx.stroke();
    ctx.fillText(value.toFixed(0), left - 8, yy);
  }

  if (targetSpec && Number.isFinite(Number(targetSpec.value))) {
    const yy = y(Number(targetSpec.value));
    ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = '#c45a11';
    ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(width - right, yy); ctx.stroke(); ctx.restore();
  }

  datasetsSpec.forEach(ds => {
    const points = (ds.points || []).filter(p => Number.isFinite(Number(p.value)));
    if (!points.length) return;
    ctx.strokeStyle = ds.color || '#0f5c8d';
    ctx.fillStyle = ds.color || '#0f5c8d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((point, i) => {
      const px = x(i), py = y(Number(point.value));
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
    points.forEach((point, i) => {
      ctx.beginPath(); ctx.arc(x(i), y(Number(point.value)), 3, 0, Math.PI * 2); ctx.fill();
    });
  });

  const firstPoints = datasetsSpec[0]?.points || [];
  ctx.fillStyle = '#64748b'; ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  if (firstPoints.length) {
    const indexes = [...new Set([0, Math.floor((firstPoints.length - 1) / 2), firstPoints.length - 1])];
    indexes.forEach(i => ctx.fillText(formatShortDate(firstPoints[i].timestamp), x(i), height - bottom + 8));
  }

  const legendItems = datasetsSpec.map(ds => ({ label: ds.label, color: ds.color || '#0f5c8d' }));
  if (targetSpec) legendItems.push({ label: targetSpec.label || 'Objetivo', color: '#c45a11' });
  let legendX = left;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '11px system-ui, sans-serif';
  legendItems.forEach(item => {
    ctx.fillStyle = item.color; ctx.fillRect(legendX, height - 13, 9, 9);
    ctx.fillStyle = '#334155'; ctx.fillText(item.label, legendX + 13, height - 8);
    legendX += ctx.measureText(item.label).width + 29;
  });
}

export function renderLineChart(canvasId, datasetsSpec, targetSpec = null) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  const previous = chartInstances.get(canvasId);
  previous?.observer?.disconnect();
  drawChart(canvas, datasetsSpec, targetSpec);
  const redraw = () => drawChart(canvas, datasetsSpec, targetSpec);
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    chartInstances.set(canvasId, { canvas, redraw, observer });
  } else {
    chartInstances.set(canvasId, { canvas, redraw });
  }
  return chartInstances.get(canvasId);
}

export function getChartImageDataUrls() {
  return [...chartInstances.entries()]
    .filter(([id]) => id.startsWith('chart-ind-'))
    .map(([id, chart]) => ({
      id,
      title: id,
      dataUrl: chart.canvas.toDataURL('image/png')
    }));
}
