import { computeStats, extractSeries, filterReadings, formatCsvEs } from './stats.js';
import { getChartImageDataUrls } from './charts.js';

function fmtDateEs(iso) {
  if (!iso) return 'sin registros';
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(iso));
}

function fmtStatLine(label, unit, stats) {
  if (!stats || stats.n === 0) {
    return `${label}: sin registros (n = 0)`;
  }
  return `${label}: media ${stats.mean.toFixed(1)} ${unit} · mín ${stats.min} · máx ${stats.max} (n = ${stats.n})`;
}

export function renderMedicalReport(allReadings, { fromDate, toDate }) {
  const filtered = filterReadings(allReadings, { fromDate, toDate });
  const bpReadings = filtered.filter((r) => r.type === 'bp');
  const weightReadings = filtered.filter((r) => r.type === 'weight');

  const periodEl = document.getElementById('report-period-line');
  const genEl = document.getElementById('report-generated-at');
  const summaryEl = document.getElementById('report-summary-content');
  const factorsEl = document.getElementById('report-factors-content');
  const tbodyEl = document.getElementById('report-table-body');
  const chartsImgsEl = document.getElementById('report-charts-images');

  if (periodEl) {
    periodEl.textContent = `Periodo: ${fromDate || 'Inicio'} a ${toDate || 'Hoy'} · Total mediciones: ${filtered.length} (PA: ${bpReadings.length}, Peso: ${weightReadings.length})`;
  }
  if (genEl) {
    genEl.textContent = `Generado: ${fmtDateEs(new Date().toISOString())} · Unidades: mmHg, lpm, kg`;
  }

  const sysStats = computeStats(extractSeries(filtered, 'sys', 'individual'));
  const diaStats = computeStats(extractSeries(filtered, 'dia', 'individual'));
  const bpmStats = computeStats(extractSeries(filtered, 'bpm', 'individual'));
  const weightStats = computeStats(extractSeries(filtered, 'weight', 'individual'));

  if (summaryEl) {
    summaryEl.replaceChildren();
    const lines = [
      fmtStatLine('Presión sistólica (SYS)', 'mmHg', sysStats),
      fmtStatLine('Presión diastólica (DIA)', 'mmHg', diaStats),
      fmtStatLine('Frecuencia cardíaca (BPM)', 'lpm', bpmStats),
      fmtStatLine('Peso corporal', 'kg', weightStats)
    ];
    for (const text of lines) {
      const p = document.createElement('p');
      p.textContent = text;
      summaryEl.appendChild(p);
    }
  }

  if (factorsEl) {
    factorsEl.replaceChildren();

    const weightP = document.createElement('p');
    if (weightReadings.length >= 2) {
      const firstW = Number(weightReadings[0].weightKg);
      const lastW = Number(weightReadings[weightReadings.length - 1].weightKg);
      const diff = lastW - firstW;
      const sign = diff > 0 ? '+' : '';
      weightP.textContent = `Evolución del peso en el periodo: ${firstW.toFixed(1)} kg → ${lastW.toFixed(1)} kg (${sign}${diff.toFixed(1)} kg).`;
    } else if (weightReadings.length === 1) {
      weightP.textContent = `Evolución del peso en el periodo: único registro de ${Number(weightReadings[0].weightKg).toFixed(1)} kg.`;
    } else {
      weightP.textContent = 'Evolución del peso en el periodo: sin registros.';
    }
    factorsEl.appendChild(weightP);

    const symptomsFound = [];
    const medsFound = [];
    const habitsFound = [];
    const notesFound = [];

    for (const r of filtered) {
      const f = r.factors || {};
      if (Array.isArray(f.symptoms) && f.symptoms.length > 0) {
        symptomsFound.push(`${fmtDateEs(r.timestamp)}: ${f.symptoms.join(', ')}${f.symptomsText ? ` (${f.symptomsText})` : ''}`);
      }
      if (f.medication && f.medication.name) {
        medsFound.push(`${fmtDateEs(r.timestamp)}: ${f.medication.name}${f.medication.dose ? ` ${f.medication.dose}` : ''}${f.medication.time ? ` a las ${f.medication.time}` : ''}`);
      }
      if (f.habits && (f.habits.coffee || f.habits.alcohol || f.habits.saltyFood || f.habits.hydration || f.habits.stress)) {
        const parts = [];
        if (f.habits.coffee) parts.push(`café: ${f.habits.coffee}`);
        if (f.habits.alcohol) parts.push('alcohol');
        if (f.habits.saltyFood) parts.push('comida salada');
        if (f.habits.hydration) parts.push(`hidratación: ${f.habits.hydration}`);
        if (f.habits.stress) parts.push(`estrés: ${f.habits.stress}/5`);
        habitsFound.push(`${fmtDateEs(r.timestamp)}: ${parts.join(', ')}`);
      }
      if (r.notes) {
        notesFound.push(`${fmtDateEs(r.timestamp)}: ${r.notes}`);
      }
    }

    const addFactorBlock = (title, items) => {
      const box = document.createElement('div');
      const h4 = document.createElement('strong');
      h4.textContent = `${title}: `;
      box.appendChild(h4);
      const span = document.createElement('span');
      span.textContent = items.length > 0 ? items.join(' · ') : 'sin registros';
      box.appendChild(span);
      factorsEl.appendChild(box);
    };

    addFactorBlock('Síntomas', symptomsFound);
    addFactorBlock('Hábitos relevantes', habitsFound);
    addFactorBlock('Medicación registrada', medsFound);
    addFactorBlock('Observaciones', notesFound);
  }

  if (chartsImgsEl) {
    chartsImgsEl.replaceChildren();
    const imgs = getChartImageDataUrls();
    if (imgs.length === 0) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Sin gráficos disponibles para el periodo seleccionado.';
      chartsImgsEl.appendChild(p);
    } else {
      for (const item of imgs) {
        const fig = document.createElement('figure');
        fig.style.margin = '0';
        const img = document.createElement('img');
        img.src = item.dataUrl;
        img.alt = item.title;
        fig.appendChild(img);
        chartsImgsEl.appendChild(fig);
      }
    }
  }

  if (tbodyEl) {
    tbodyEl.replaceChildren();
    if (filtered.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = 'Sin registros en el periodo seleccionado.';
      tr.appendChild(td);
      tbodyEl.appendChild(tr);
    } else {
      for (const r of filtered.slice().reverse()) {
        const tr = document.createElement('tr');

        const tdDate = document.createElement('td');
        tdDate.textContent = fmtDateEs(r.timestamp);

        const tdType = document.createElement('td');
        tdType.textContent = r.type === 'bp' ? 'Presión arterial' : 'Peso';

        const tdVal = document.createElement('td');
        tdVal.textContent = r.type === 'bp'
          ? `${r.sys}/${r.dia} mmHg · ${r.bpm} lpm`
          : `${Number(r.weightKg).toFixed(1)} kg`;

        const tdCond = document.createElement('td');
        tdCond.textContent = r.type === 'bp'
          ? `${r.arm === 'left' ? 'Brazo izq.' : 'Brazo der.'}, ${r.position === 'seated' ? 'sentado' : 'de pie'} (#${r.sessionReadingIndex || 1})`
          : '—';

        const tdExtra = document.createElement('td');
        const f = r.factors || {};
        const extraBits = [];
        if (Array.isArray(f.symptoms) && f.symptoms.length) extraBits.push(`Síntomas: ${f.symptoms.join(', ')}`);
        if (f.medication && f.medication.name) extraBits.push(`Med: ${f.medication.name}`);
        if (r.notes) extraBits.push(`Obs: ${r.notes}`);
        tdExtra.textContent = extraBits.length > 0 ? extraBits.join(' | ') : 'sin registros';

        tr.append(tdDate, tdType, tdVal, tdCond, tdExtra);
        tbodyEl.appendChild(tr);
      }
    }
  }

  return filtered;
}

export function triggerFileDownload(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportReadingsCsv(readings) {
  const csv = formatCsvEs(readings);
  triggerFileDownload(`healthtrack-informe-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8;');
}

export function exportReadingsJson(readings, schemaVersion = 1) {
  const payload = {
    app: 'HealthTrack',
    schemaVersion,
    exportedAt: new Date().toISOString(),
    readings
  };
  triggerFileDownload(
    `healthtrack-copia-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(payload, null, 2),
    'application/json'
  );
}