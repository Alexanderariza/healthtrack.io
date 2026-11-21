import { VALIDATION_BOUNDS, PLAUSIBLE_WARNINGS, SESSION_WINDOW_MINUTES } from './config.js';

export function parseDecimalInput(raw) {
  if (raw === null || raw === undefined) return NaN;
  const cleaned = String(raw).trim().replace(',', '.');
  if (cleaned === '' || !/^-?\d+(\.\d+)?$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

export function validateReading(input) {
  const errors = [];
  const warnings = [];

  if (!input || typeof input !== 'object') {
    return { valid: false, errors: ['Datos de medición inválidos.'], warnings: [] };
  }

  const ts = new Date(input.timestamp);
  if (!input.timestamp || Number.isNaN(ts.getTime())) {
    errors.push('La fecha y hora no son válidas.');
  }

  if (input.type === 'bp') {
    const sys = Number(input.sys);
    const dia = Number(input.dia);
    const bpm = Number(input.bpm);

    if (!Number.isFinite(sys) || !Number.isInteger(sys) || sys < VALIDATION_BOUNDS.sys.min || sys > VALIDATION_BOUNDS.sys.max) {
      errors.push(`SYS debe ser un entero entre ${VALIDATION_BOUNDS.sys.min} y ${VALIDATION_BOUNDS.sys.max} mmHg.`);
    }
    if (!Number.isFinite(dia) || !Number.isInteger(dia) || dia < VALIDATION_BOUNDS.dia.min || dia > VALIDATION_BOUNDS.dia.max) {
      errors.push(`DIA debe ser un entero entre ${VALIDATION_BOUNDS.dia.min} y ${VALIDATION_BOUNDS.dia.max} mmHg.`);
    }
    if (!Number.isFinite(bpm) || !Number.isInteger(bpm) || bpm < VALIDATION_BOUNDS.bpm.min || bpm > VALIDATION_BOUNDS.bpm.max) {
      errors.push(`BPM debe ser un entero entre ${VALIDATION_BOUNDS.bpm.min} y ${VALIDATION_BOUNDS.bpm.max} lpm.`);
    }
    if (errors.length === 0 && sys <= dia) {
      errors.push('La presión sistólica (SYS) debe ser mayor que la diastólica (DIA).');
    }

    if (errors.length === 0) {
      if (sys < PLAUSIBLE_WARNINGS.sysLow || sys > PLAUSIBLE_WARNINGS.sysHigh) {
        warnings.push(`SYS de ${sys} mmHg es un valor poco habitual. Confirma si es correcto.`);
      }
      if (dia < PLAUSIBLE_WARNINGS.diaLow || dia > PLAUSIBLE_WARNINGS.diaHigh) {
        warnings.push(`DIA de ${dia} mmHg es un valor poco habitual. Confirma si es correcto.`);
      }
      if (bpm < PLAUSIBLE_WARNINGS.bpmLow || bpm > PLAUSIBLE_WARNINGS.bpmHigh) {
        warnings.push(`BPM de ${bpm} lpm es un valor poco habitual. Confirma si es correcto.`);
      }
    }
  } else if (input.type === 'weight') {
    const weightKg = parseDecimalInput(input.weightKg);
    if (!Number.isFinite(weightKg) || weightKg < VALIDATION_BOUNDS.weightKg.min || weightKg > VALIDATION_BOUNDS.weightKg.max) {
      errors.push(`El peso debe estar entre ${VALIDATION_BOUNDS.weightKg.min} y ${VALIDATION_BOUNDS.weightKg.max} kg.`);
    } else if (weightKg < PLAUSIBLE_WARNINGS.weightLow || weightKg > PLAUSIBLE_WARNINGS.weightHigh) {
      warnings.push(`El peso de ${weightKg.toFixed(1)} kg parece poco habitual. Confirma si es correcto.`);
    }
  } else {
    errors.push('Tipo de medición no soportado.');
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function groupIntoSessions(readings, windowMinutes = SESSION_WINDOW_MINUTES) {
  const windowMs = windowMinutes * 60 * 1000;
  const bpSorted = readings
    .filter((r) => r.type === 'bp')
    .slice()
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const sessions = [];
  let current = null;

  for (const item of bpSorted) {
    const t = new Date(item.timestamp).getTime();
    if (!current || t - current.lastTime > windowMs) {
      current = {
        sessionId: `session-${item.id}`,
        startTime: t,
        lastTime: t,
        items: []
      };
      sessions.push(current);
    }
    current.lastTime = t;
    const enriched = {
      ...item,
      sessionId: current.sessionId,
      sessionReadingIndex: item.sessionReadingIndex || current.items.length + 1
    };
    current.items.push(enriched);
  }

  const enrichedMap = new Map();
  for (const s of sessions) {
    for (const it of s.items) {
      enrichedMap.set(it.id, it);
    }
  }

  const allEnriched = readings.map((r) => (r.type === 'bp' && enrichedMap.has(r.id) ? enrichedMap.get(r.id) : r));
  return { sessions, readings: allEnriched };
}

function getHourOfDay(timestamp) {
  return new Date(timestamp).getHours();
}

export function filterReadings(readings, options = {}) {
  const {
    days = null,
    fromDate = null,
    toDate = null,
    type = 'all',
    arm = 'all',
    position = 'all',
    timeWindow = 'all',
    excludeFirstDay = false,
    referenceNow = new Date()
  } = options;

  let list = readings.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (type !== 'all') {
    list = list.filter((r) => r.type === type);
  }

  if (typeof days === 'number' && days > 0) {
    const cutoffMs = new Date(referenceNow).getTime() - days * 24 * 60 * 60 * 1000;
    list = list.filter((r) => new Date(r.timestamp).getTime() >= cutoffMs);
  }

  if (fromDate) {
    const startMs = new Date(`${fromDate}T00:00:00`).getTime();
    if (!Number.isNaN(startMs)) {
      list = list.filter((r) => new Date(r.timestamp).getTime() >= startMs);
    }
  }

  if (toDate) {
    const endMs = new Date(`${toDate}T23:59:59.999`).getTime();
    if (!Number.isNaN(endMs)) {
      list = list.filter((r) => new Date(r.timestamp).getTime() <= endMs);
    }
  }

  if (excludeFirstDay && list.length > 0) {
    const firstDayKey = new Date(list[0].timestamp).toISOString().slice(0, 10);
    list = list.filter((r) => new Date(r.timestamp).toISOString().slice(0, 10) !== firstDayKey);
  }

  if (arm !== 'all') {
    list = list.filter((r) => r.type !== 'bp' || r.arm === arm);
  }

  if (position !== 'all') {
    list = list.filter((r) => r.type !== 'bp' || r.position === position);
  }

  if (timeWindow !== 'all') {
    list = list.filter((r) => {
      const h = getHourOfDay(r.timestamp);
      if (timeWindow === 'morning') return h >= 5 && h <= 11;
      if (timeWindow === 'afternoon') return h >= 12 && h <= 18;
      if (timeWindow === 'evening') return h >= 19 || h <= 4;
      return true;
    });
  }

  return list;
}

export function computeTrendPerWeek(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const t0 = new Date(points[0].timestamp).getTime();
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;

  const xs = points.map((p) => (new Date(p.timestamp).getTime() - t0) / msPerWeek);
  const ys = points.map((p) => Number(p.value));

  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    num += dx * (ys[i] - meanY);
    den += dx * dx;
  }

  if (den === 0) return 0;
  return num / den;
}

export function computeStats(points) {
  const valid = (points || []).filter((p) => p && Number.isFinite(Number(p.value)));
  if (valid.length === 0) {
    return { n: 0, mean: null, min: null, max: null, trendPerWeek: null };
  }
  const values = valid.map((p) => Number(p.value));
  const sum = values.reduce((acc, v) => acc + v, 0);
  return {
    n: valid.length,
    mean: sum / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    trendPerWeek: computeTrendPerWeek(valid)
  };
}

export function extractSeries(readings, metric, aggregation = 'individual') {
  if (metric === 'weight') {
    return readings
      .filter((r) => r.type === 'weight' && Number.isFinite(Number(r.weightKg)))
      .map((r) => ({ timestamp: r.timestamp, value: Number(r.weightKg), id: r.id }));
  }

  const bp = readings.filter((r) => r.type === 'bp');
  if (aggregation === 'session') {
    const grouped = new Map();
    for (const r of bp) {
      const key = r.sessionId || r.id;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(r);
    }
    const result = [];
    for (const [, items] of grouped.entries()) {
      const nums = items.map((x) => Number(x[metric])).filter((v) => Number.isFinite(v));
      if (nums.length > 0) {
        const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
        result.push({
          timestamp: items[items.length - 1].timestamp,
          value: Number(avg.toFixed(1)),
          sessionCount: items.length
        });
      }
    }
    return result.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  return bp
    .filter((r) => Number.isFinite(Number(r[metric])))
    .map((r) => ({ timestamp: r.timestamp, value: Number(r[metric]), id: r.id }));
}

export function formatCsvEs(readings) {
  const BOM = '\uFEFF';
  const sep = ';';
  const headers = [
    'id',
    'fecha_hora',
    'tipo',
    'sys_mmhg',
    'dia_mmhg',
    'bpm_lpm',
    'peso_kg',
    'brazo',
    'posicion',
    'n_sesion',
    'sintomas',
    'medicacion',
    'observaciones'
  ];

  const escapeCell = (val) => {
    const str = val === null || val === undefined ? '' : String(val);
    const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
    if (safe.includes(sep) || safe.includes('"') || safe.includes('\n')) {
      return `"${safe.replace(/"/g, '""')}"`;
    }
    return safe;
  };

  const rows = readings.map((r) => {
    const f = r.factors || {};
    const symptoms = Array.isArray(f.symptoms) ? f.symptoms.join(', ') : '';
    const med = f.medication && f.medication.name
      ? `${f.medication.name}${f.medication.dose ? ` (${f.medication.dose})` : ''}`
      : '';
    return [
      r.id,
      r.timestamp,
      r.type === 'bp' ? 'presion_arterial' : 'peso',
      r.type === 'bp' ? r.sys : '',
      r.type === 'bp' ? r.dia : '',
      r.type === 'bp' ? r.bpm : '',
      r.type === 'weight' ? Number(r.weightKg).toFixed(1).replace('.', ',') : '',
      r.type === 'bp' ? r.arm || '' : '',
      r.type === 'bp' ? r.position || '' : '',
      r.type === 'bp' ? r.sessionReadingIndex || '' : '',
      symptoms,
      med,
      r.notes || ''
    ]
      .map(escapeCell)
      .join(sep);
  });

  return BOM + [headers.join(sep), ...rows].join('\r\n');
}

export function validateImportPayload(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.readings)) {
    return { ok: false, error: 'El archivo JSON no contiene un arreglo válido de "readings".', validRecords: [] };
  }

  const validRecords = [];
  for (const item of payload.readings) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim()) {
      return { ok: false, error: 'Cada registro debe incluir un "id" de texto válido.', validRecords: [] };
    }
    const check = validateReading(item);
    if (!check.valid) {
      return { ok: false, error: `Registro inválido (${item.id}): ${check.errors.join(' ')}`, validRecords: [] };
    }
    validRecords.push(item);
  }

  return { ok: true, error: null, validRecords };
}