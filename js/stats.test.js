import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStats,
  extractSeries,
  filterReadings,
  formatCsvEs,
  groupIntoSessions,
  parseDecimalInput,
  validateImportPayload,
  validateReading
} from '../js/stats.js';

test('parseDecimalInput acepta coma y punto decimal', () => {
  assert.equal(parseDecimalInput('74,5'), 74.5);
  assert.equal(parseDecimalInput('74.5'), 74.5);
  assert.ok(Number.isNaN(parseDecimalInput('abc')));
});

test('validateReading aplica validación de dos niveles en presión y peso', () => {
  const errSysLeDia = validateReading({
    type: 'bp',
    sys: 110,
    dia: 115,
    bpm: 70,
    timestamp: '2026-11-20T08:00:00+01:00'
  });
  assert.equal(errSysLeDia.valid, false);
  assert.ok(errSysLeDia.errors.length > 0);

  const warnExtremePlausible = validateReading({
    type: 'bp',
    sys: 225,
    dia: 105,
    bpm: 75,
    timestamp: '2026-11-20T08:00:00+01:00'
  });
  assert.equal(warnExtremePlausible.valid, true);
  assert.ok(warnExtremePlausible.warnings.length > 0);
});

test('groupIntoSessions agrupa mediciones dentro de 30 minutos', () => {
  const sample = [
    { id: '1', type: 'bp', sys: 130, dia: 85, bpm: 72, timestamp: '2026-11-20T08:00:00+01:00' },
    { id: '2', type: 'bp', sys: 126, dia: 82, bpm: 70, timestamp: '2026-11-20T08:03:00+01:00' },
    { id: '3', type: 'bp', sys: 135, dia: 88, bpm: 76, timestamp: '2026-11-20T18:00:00+01:00' }
  ];
  const { sessions } = groupIntoSessions(sample, 30);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].items.length, 2);
  assert.equal(sessions[1].items.length, 1);
});

test('computeStats y extractSeries calculan media, mín, máx, n y tendencia por sesión', () => {
  const sample = [
    { id: '1', type: 'bp', sys: 140, dia: 90, bpm: 75, sessionId: 's1', timestamp: '2026-11-01T08:00:00+01:00' },
    { id: '2', type: 'bp', sys: 130, dia: 85, bpm: 71, sessionId: 's1', timestamp: '2026-11-01T08:03:00+01:00' },
    { id: '3', type: 'bp', sys: 120, dia: 80, bpm: 68, sessionId: 's2', timestamp: '2026-11-08T08:00:00+01:00' }
  ];
  const sessionSys = extractSeries(sample, 'sys', 'session');
  assert.equal(sessionSys.length, 2);
  assert.equal(sessionSys[0].value, 135);
  const st = computeStats(sessionSys);
  assert.equal(st.n, 2);
  assert.equal(st.mean, 127.5);
  assert.equal(st.min, 120);
  assert.equal(st.max, 135);
  assert.equal(Math.round(st.trendPerWeek), -15);
});

test('filterReadings soporta excluir el primer día y filtrar por condición', () => {
  const sample = [
    { id: '1', type: 'bp', sys: 150, dia: 95, bpm: 80, arm: 'left', position: 'seated', timestamp: '2026-11-10T08:00:00+01:00' },
    { id: '2', type: 'bp', sys: 125, dia: 80, bpm: 68, arm: 'left', position: 'seated', timestamp: '2026-11-11T08:00:00+01:00' },
    { id: '3', type: 'bp', sys: 128, dia: 82, bpm: 70, arm: 'right', position: 'seated', timestamp: '2026-11-12T08:00:00+01:00' }
  ];
  const noDay1 = filterReadings(sample, { excludeFirstDay: true });
  assert.equal(noDay1.length, 2);
  const leftOnly = filterReadings(sample, { arm: 'left' });
  assert.equal(leftOnly.length, 2);
});

test('formatCsvEs genera BOM UTF-8, separador punto y coma y escapa fórmulas', () => {
  const csv = formatCsvEs([
    {
      id: 'r1',
      type: 'weight',
      weightKg: 72.4,
      timestamp: '2026-11-20T07:30:00+01:00',
      notes: '=SUM(A1:A2)'
    }
  ]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes(';'));
  assert.ok(csv.includes('72,4'));
  assert.ok(csv.includes("'=SUM(A1:A2)"));
});

test('validateImportPayload valida estructura y rechaza datos corruptos', () => {
  const bad = validateImportPayload({ readings: [{ id: 'x', type: 'bp', sys: 10, dia: 80, bpm: 60, timestamp: '2026-11-20T08:00:00+01:00' }] });
  assert.equal(bad.ok, false);

  const ok = validateImportPayload({
    readings: [{ id: 'ok-1', type: 'weight', weightKg: 70.2, timestamp: '2026-11-20T08:00:00+01:00' }]
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.validRecords.length, 1);
});