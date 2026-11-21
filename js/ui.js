import { CLINICAL_THRESHOLDS, PREF_KEYS } from './config.js';
import { toLocalIsoOffsetString } from './db.js';
import { computeStats, extractSeries, filterReadings, parseDecimalInput } from './stats.js';
import { renderLineChart } from './charts.js';

export function formatDateTimeEs(iso) {
  if (!iso) return 'Sin registros';
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(iso));
}

export function toDatetimeLocalValue(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function evaluateClinicalAlerts(readings) {
  const alerts = [];
  const recentBp = readings.filter((r) => r.type === 'bp').slice(0, 5);

  for (const r of recentBp) {
    const sys = Number(r.sys);
    const dia = Number(r.dia);
    const symptoms = (r.factors && Array.isArray(r.factors.symptoms) ? r.factors.symptoms : []).map((s) => s.toLowerCase());
    const hasLowBpSymptoms = symptoms.some((s) => s.includes('mareo') || s.includes('desmayo') || s.includes('confusión'));

    if (sys >= CLINICAL_THRESHOLDS.bpUrgentSys || dia >= CLINICAL_THRESHOLDS.bpUrgentDia) {
      alerts.push({
        urgent: true,
        text: `Lectura elevada (${sys}/${dia} mmHg el ${formatDateTimeEs(r.timestamp)}): repite la medición tras 5 minutos de reposo. Si persiste, contacta con tu médica o servicio de urgencias sin demora. Si presentas dolor torácico, dificultad para respirar, debilidad o entumecimiento, cambios en la visión o dificultad para hablar, llama a emergencias (112) de inmediato.`
      });
      break;
    }

    if ((sys < CLINICAL_THRESHOLDS.bpLowSys || dia < CLINICAL_THRESHOLDS.bpLowDia) && hasLowBpSymptoms) {
      alerts.push({
        urgent: false,
        text: `Lectura baja (${sys}/${dia} mmHg el ${formatDateTimeEs(r.timestamp)}) con síntomas registrados: consulta con tu médica.`
      });
      break;
    }
  }

  return alerts;
}

export function renderDashboard(readings, targets = {}) {
  const alertsContainer = document.getElementById('clinical-alerts-container');
  const emptyBox = document.getElementById('dashboard-empty');
  const chartsGrid = document.getElementById('dashboard-charts-grid');

  if (alertsContainer) {
    alertsContainer.replaceChildren();
    for (const alert of evaluateClinicalAlerts(readings)) {
      const div = document.createElement('div');
      div.className = `alert-card${alert.urgent ? ' alert-card--urgent' : ''}`;
      const p = document.createElement('p');
      p.style.margin = '0';
      p.textContent = alert.text;
      div.appendChild(p);
      alertsContainer.appendChild(div);
    }
  }

  const hasData = readings.length > 0;
  if (emptyBox) emptyBox.hidden = hasData;
  if (chartsGrid) chartsGrid.hidden = !hasData;

  const latestBp = readings.find((r) => r.type === 'bp');
  const latestWeight = readings.find((r) => r.type === 'weight');

  const bpValEl = document.getElementById('kpi-bp-value');
  const bpTimeEl = document.getElementById('kpi-bp-time');
  const bpCtxEl = document.getElementById('kpi-bp-context');
  if (bpValEl && bpTimeEl && bpCtxEl) {
    if (latestBp) {
      bpValEl.textContent = `${latestBp.sys} / ${latestBp.dia}`;
      bpTimeEl.textContent = formatDateTimeEs(latestBp.timestamp);
      bpCtxEl.textContent = `${latestBp.arm === 'left' ? 'Brazo izq.' : 'Brazo der.'} · ${latestBp.position === 'seated' ? 'Sentado' : 'De pie'}`;
    } else {
      bpValEl.textContent = '— / —';
      bpTimeEl.textContent = 'Sin registros';
      bpCtxEl.textContent = 'Brazo y posición no registrados';
    }
  }

  const bpmValEl = document.getElementById('kpi-bpm-value');
  const bpmTimeEl = document.getElementById('kpi-bpm-time');
  if (bpmValEl && bpmTimeEl) {
    if (latestBp) {
      bpmValEl.textContent = String(latestBp.bpm);
      bpmTimeEl.textContent = formatDateTimeEs(latestBp.timestamp);
    } else {
      bpmValEl.textContent = '—';
      bpmTimeEl.textContent = 'Sin registros';
    }
  }

  const wValEl = document.getElementById('kpi-weight-value');
  const wTimeEl = document.getElementById('kpi-weight-time');
  const wDeltaEl = document.getElementById('kpi-weight-delta');
  if (wValEl && wTimeEl && wDeltaEl) {
    if (latestWeight) {
      wValEl.textContent = Number(latestWeight.weightKg).toFixed(1).replace('.', ',');
      wTimeEl.textContent = formatDateTimeEs(latestWeight.timestamp);
      const weightsAsc = readings.filter((r) => r.type === 'weight').slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      if (weightsAsc.length >= 2) {
        const delta = Number(weightsAsc[weightsAsc.length - 1].weightKg) - Number(weightsAsc[0].weightKg);
        const sign = delta > 0 ? '+' : '';
        wDeltaEl.textContent = `Variación acumulada: ${sign}${delta.toFixed(1).replace('.', ',')} kg`;
      } else {
        wDeltaEl.textContent = 'Primer registro de peso';
      }
    } else {
      wValEl.textContent = '—';
      wTimeEl.textContent = 'Sin registros';
      wDeltaEl.textContent = 'Variación del periodo: —';
    }
  }

  const allSys = extractSeries(readings, 'sys', 'individual');
  const allDia = extractSeries(readings, 'dia', 'individual');
  const sysStats = computeStats(allSys);
  const diaStats = computeStats(allDia);

  const avgBpEl = document.getElementById('kpi-avg-bp');
  const avgNEl = document.getElementById('kpi-avg-n');
  const totalCountEl = document.getElementById('kpi-total-count');

  if (avgBpEl && avgNEl) {
    if (sysStats.n > 0 && diaStats.n > 0) {
      avgBpEl.textContent = `${sysStats.mean.toFixed(0)} / ${diaStats.mean.toFixed(0)}`;
      avgNEl.textContent = `n = ${sysStats.n}`;
    } else {
      avgBpEl.textContent = '— / —';
      avgNEl.textContent = 'n = 0';
    }
  }
  if (totalCountEl) {
    totalCountEl.textContent = `Total de mediciones: ${readings.length}`;
  }

  if (hasData) {
    const r7 = filterReadings(readings, { days: 7, type: 'bp' });
    const r14 = filterReadings(readings, { days: 14, type: 'bp' });

    const s7 = extractSeries(r7, 'sys', 'individual');
    const d7 = extractSeries(r7, 'dia', 'individual');
    const s14 = extractSeries(r14, 'sys', 'individual');
    const d14 = extractSeries(r14, 'dia', 'individual');

    const d7Badge = document.getElementById('dash-7d-summary');
    const d14Badge = document.getElementById('dash-14d-summary');
    if (d7Badge) d7Badge.textContent = `n = ${s7.length}`;
    if (d14Badge) d14Badge.textContent = `n = ${s14.length}`;

    renderLineChart(
      'chart-dash-7d',
      [
        { label: 'SYS (mmHg)', points: s7, color: '#0f5c8d' },
        { label: 'DIA (mmHg)', points: d7, color: '#157a5c' }
      ],
      targets.sys ? { label: 'Objetivo SYS', value: targets.sys } : null
    );

    renderLineChart(
      'chart-dash-14d',
      [
        { label: 'SYS (mmHg)', points: s14, color: '#0f5c8d' },
        { label: 'DIA (mmHg)', points: d14, color: '#157a5c' }
      ],
      targets.sys ? { label: 'Objetivo SYS', value: targets.sys } : null
    );
  }
}

export function renderHistory(readings, filters, { onEdit, onDelete }) {
  const container = document.getElementById('history-list');
  const countLabel = document.getElementById('history-count-label');
  if (!container) return;

  let list = filterReadings(readings, {
    fromDate: filters.from || null,
    toDate: filters.to || null,
    type: filters.type || 'all'
  });

  if (filters.condition && filters.condition !== 'all') {
    list = list.filter((r) => {
      if (filters.condition === 'arm-left') return r.type === 'bp' && r.arm === 'left';
      if (filters.condition === 'arm-right') return r.type === 'bp' && r.arm === 'right';
      if (filters.condition === 'pos-seated') return r.type === 'bp' && r.position === 'seated';
      if (filters.condition === 'pos-standing') return r.type === 'bp' && r.position === 'standing';
      if (filters.condition === 'with-symptoms') return Array.isArray(r.factors?.symptoms) && r.factors.symptoms.length > 0;
      if (filters.condition === 'with-medication') return Boolean(r.factors?.medication?.name);
      return true;
    });
  }

  list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (countLabel) {
    countLabel.textContent = `${list.length} registro(s) mostrado(s)`;
  }

  container.replaceChildren();

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'card empty-state';
    const p = document.createElement('p');
    p.textContent = 'No hay registros que coincidan con el filtro seleccionado.';
    empty.appendChild(p);
    container.appendChild(empty);
    return;
  }

  const byDay = new Map();
  for (const r of list) {
    const dayKey = new Date(r.timestamp).toISOString().slice(0, 10);
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey).push(r);
  }

  for (const [dayKey, dayItems] of byDay.entries()) {
    const dayGroup = document.createElement('div');
    dayGroup.className = 'history-day-group';

    const h3 = document.createElement('h3');
    h3.className = 'history-day-title';
    h3.textContent = new Intl.DateTimeFormat('es-ES', { dateStyle: 'full' }).format(new Date(`${dayKey}T12:00:00`));
    dayGroup.appendChild(h3);

    for (const r of dayItems) {
      const card = document.createElement('article');
      card.className = 'card record-item';

      const info = document.createElement('div');
      const mainLine = document.createElement('div');
      mainLine.className = 'record-item__main';
      mainLine.textContent = r.type === 'bp'
        ? `${r.sys} / ${r.dia} mmHg · ${r.bpm} lpm`
        : `${Number(r.weightKg).toFixed(1).replace('.', ',')} kg`;

      const metaLine = document.createElement('div');
      metaLine.className = 'record-item__meta';
      const timeStr = new Intl.DateTimeFormat('es-ES', { timeStyle: 'short' }).format(new Date(r.timestamp));
      const detailStr = r.type === 'bp'
        ? `${timeStr} · Sesión (${r.sessionId ? r.sessionId.slice(-6) : '—'}) · Toma #${r.sessionReadingIndex || 1} · ${r.arm === 'left' ? 'Izq.' : 'Der.'}, ${r.position === 'seated' ? 'sentado' : 'de pie'}`
        : `${timeStr} · Registro de peso`;
      metaLine.textContent = detailStr;

      info.append(mainLine, metaLine);

      if (r.notes) {
        const noteLine = document.createElement('div');
        noteLine.className = 'record-item__meta';
        noteLine.textContent = `Nota: ${r.notes}`;
        info.appendChild(noteLine);
      }

      const actions = document.createElement('div');
      actions.className = 'record-item__actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn--ghost btn--sm';
      editBtn.textContent = 'Editar';
      editBtn.addEventListener('click', () => onEdit(r));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn--danger btn--sm';
      delBtn.textContent = 'Eliminar';
      delBtn.addEventListener('click', () => onDelete(r));

      actions.append(editBtn, delBtn);
      card.append(info, actions);
      dayGroup.appendChild(card);
    }

    container.appendChild(dayGroup);
  }
}

export function renderStatisticsTab(readings, opts, targets = {}) {
  const cond = opts.condition || 'all';
  const arm = cond.startsWith('arm-') ? cond.replace('arm-', '') : 'all';
  const position = cond.startsWith('pos-') ? cond.replace('pos-', '') : 'all';

  const filtered = filterReadings(readings, {
    days: Number(opts.range || 14),
    arm,
    position,
    timeWindow: opts.timeWindow || 'all',
    excludeFirstDay: Boolean(opts.excludeFirstDay)
  });

  const agg = opts.aggregation || 'individual';
  const sysSeries = extractSeries(filtered, 'sys', agg);
  const diaSeries = extractSeries(filtered, 'dia', agg);
  const bpmSeries = extractSeries(filtered, 'bpm', agg);
  const weightSeries = extractSeries(filtered, 'weight', 'individual');

  const writeStat = (prefix, unit, series, isWeightDelta = false) => {
    const st = computeStats(series);
    const mainEl = document.getElementById(`stat-${prefix}-main`);
    const metaEl = document.getElementById(`stat-${prefix}-meta`);
    const trendEl = document.getElementById(`stat-${prefix}-trend`);

    if (!mainEl || !metaEl || !trendEl) return;

    if (st.n === 0) {
      mainEl.textContent = 'Media: —';
      metaEl.textContent = 'Mín: — · Máx: — · n = 0';
      trendEl.textContent = isWeightDelta ? 'Variación periodo: —' : 'Tendencia: —';
      return;
    }

    mainEl.textContent = `Media: ${st.mean.toFixed(1).replace('.', ',')} ${unit}`;
    metaEl.textContent = `Mín: ${st.min} · Máx: ${st.max} · n = ${st.n}`;

    if (isWeightDelta) {
      if (series.length >= 2) {
        const diff = series[series.length - 1].value - series[0].value;
        const sign = diff > 0 ? '+' : '';
        trendEl.textContent = `Variación en el periodo: ${sign}${diff.toFixed(1).replace('.', ',')} kg`;
      } else {
        trendEl.textContent = 'Variación en el periodo: sin cambio comparable';
      }
    } else if (st.trendPerWeek !== null) {
      const sign = st.trendPerWeek > 0 ? '+' : '';
      trendEl.textContent = `Tendencia: ${sign}${st.trendPerWeek.toFixed(1).replace('.', ',')} ${unit}/semana`;
    } else {
      trendEl.textContent = 'Tendencia: datos insuficientes';
    }
  };

  writeStat('sys', 'mmHg', sysSeries, false);
  writeStat('dia', 'mmHg', diaSeries, false);
  writeStat('bpm', 'lpm', bpmSeries, false);
  writeStat('weight', 'kg', weightSeries, true);

  renderLineChart(
    'chart-ind-sys',
    [{ label: 'SYS (mmHg)', points: sysSeries, color: '#0f5c8d' }],
    targets.sys ? { label: 'Objetivo SYS', value: targets.sys } : null
  );
  renderLineChart(
    'chart-ind-dia',
    [{ label: 'DIA (mmHg)', points: diaSeries, color: '#157a5c' }],
    targets.dia ? { label: 'Objetivo DIA', value: targets.dia } : null
  );
  renderLineChart(
    'chart-ind-bpm',
    [{ label: 'BPM (lpm)', points: bpmSeries, color: '#2b6cb0' }],
    targets.bpm ? { label: 'Objetivo BPM', value: targets.bpm } : null
  );
  renderLineChart(
    'chart-ind-weight',
    [{ label: 'Peso (kg)', points: weightSeries, color: '#c45a11' }],
    targets.weight ? { label: 'Objetivo peso', value: targets.weight } : null
  );
}

export function getRememberedArm() {
  return localStorage.getItem(PREF_KEYS.lastArm) === 'right' ? 'right' : 'left';
}

export function getRememberedPosition() {
  return localStorage.getItem(PREF_KEYS.lastPosition) === 'standing' ? 'standing' : 'seated';
}

export function rememberBpContext(arm, position) {
  localStorage.setItem(PREF_KEYS.lastArm, arm);
  localStorage.setItem(PREF_KEYS.lastPosition, position);
}

export function buildRecordFromForm(existingRecord = null) {
  const type = document.getElementById('edit-record-type').value;
  const tsLocal = document.getElementById('field-timestamp').value;
  const timestamp = tsLocal ? toLocalIsoOffsetString(new Date(tsLocal)) : toLocalIsoOffsetString(new Date());

  const symptoms = Array.from(document.querySelectorAll('input[name="symptom"]:checked')).map((el) => el.value);
  const factors = {
    sleep: {
      hours: parseDecimalInput(document.getElementById('factor-sleep-hours').value),
      quality: Number(document.getElementById('factor-sleep-quality').value) || null
    },
    activity: {
      type: document.getElementById('factor-activity-type').value.trim(),
      minutes: Number(document.getElementById('factor-activity-mins').value) || null,
      intensity: document.getElementById('factor-activity-intensity').value || ''
    },
    habits: {
      coffee: Number(document.getElementById('factor-coffee').value) || 0,
      alcohol: document.getElementById('factor-alcohol').checked,
      saltyFood: document.getElementById('factor-salty').checked,
      hydration: document.getElementById('factor-hydration').value.trim(),
      stress: Number(document.getElementById('factor-stress').value) || null
    },
    symptoms,
    symptomsText: document.getElementById('factor-symptoms-text').value.trim(),
    medication: {
      name: document.getElementById('factor-med-name').value.trim(),
      dose: document.getElementById('factor-med-dose').value.trim(),
      time: document.getElementById('factor-med-time').value,
      notes: document.getElementById('factor-med-notes').value.trim()
    }
  };

  if (Number.isNaN(factors.sleep.hours)) factors.sleep.hours = null;

  const base = {
    id: existingRecord ? existingRecord.id : undefined,
    createdAt: existingRecord ? existingRecord.createdAt : undefined,
    type,
    timestamp,
    notes: document.getElementById('field-notes').value.trim(),
    factors
  };

  if (type === 'bp') {
    const arm = document.getElementById('field-arm').value;
    const position = document.getElementById('field-position').value;
    return {
      ...base,
      sys: Number(document.getElementById('field-sys').value.trim()),
      dia: Number(document.getElementById('field-dia').value.trim()),
      bpm: Number(document.getElementById('field-bpm').value.trim()),
      arm,
      position,
      sessionReadingIndex: Number(document.getElementById('field-session-index').value) || 1
    };
  }

  return {
    ...base,
    weightKg: parseDecimalInput(document.getElementById('field-weight').value)
  };
}