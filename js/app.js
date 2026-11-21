import { CLINICAL_THRESHOLDS, DEFAULT_BACKUP_ALERT_DAYS, PREF_KEYS, SCHEMA_VERSION } from './config.js';
import {
  bulkPutReadings,
  createUuid,
  deleteReading,
  getAllReadings,
  getSetting,
  putReading,
  requestPersistentStorage,
  setSetting
} from './db.js';
import { filterReadings, groupIntoSessions, parseDecimalInput, validateImportPayload, validateReading } from './stats.js';
import {
  buildRecordFromForm,
  formatDateTimeEs,
  getRememberedArm,
  getRememberedPosition,
  rememberBpContext,
  renderDashboard,
  renderHistory,
  renderStatisticsTab,
  toDatetimeLocalValue
} from './ui.js';
import { exportReadingsCsv, exportReadingsJson, renderMedicalReport } from './report.js';
import { registerServiceWorker } from './sw-register.js';

const state = {
  readings: [],
  targets: {},
  reminders: { enabled: false, morning: '08:00', evening: '20:00' },
  backupAlertDays: DEFAULT_BACKUP_ALERT_DAYS,
  lastBackupAt: null,
  editingRecord: null,
  pendingWarningConfirmed: false,
  activeTab: 'dashboard'
};

function switchTab(tabName) {
  state.activeTab = tabName;
  localStorage.setItem(PREF_KEYS.activeTab, tabName);

  const titles = {
    dashboard: ['Inicio', 'Resumen de mediciones recientes'],
    history: ['Historial', 'Cronología agrupada por día y sesión'],
    charts: ['Estadísticas', 'Gráficos independientes y opciones de cálculo'],
    report: ['Informe médico', 'Vista sobria para impresión o exportación'],
    settings: ['Ajustes y datos', 'Objetivos, recordatorios, mantenimiento y copias']
  };

  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.hidden = panel.id !== `tab-${tabName}`;
  });

  document.querySelectorAll('[data-tab]').forEach((btn) => {
    const isMatch = btn.dataset.tab === tabName;
    btn.classList.toggle('is-active', isMatch);
    if (btn.classList.contains('nav-item')) {
      if (isMatch) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }
  });

  const [t, sub] = titles[tabName] || titles.dashboard;
  const titleEl = document.getElementById('page-title');
  const subEl = document.getElementById('page-subtitle');
  if (titleEl) titleEl.textContent = t;
  if (subEl) subEl.textContent = sub;

  refreshCurrentTab();
}

function setEntryMode(mode) {
  document.getElementById('edit-record-type').value = mode;
  const isBp = mode === 'bp';
  document.getElementById('bp-fields').hidden = !isBp;
  document.getElementById('bp-context-fields').hidden = !isBp;
  document.getElementById('session-index-field').hidden = !isBp;
  document.getElementById('weight-fields').hidden = isBp;

  const modeBpBtn = document.getElementById('mode-bp');
  const modeWBtn = document.getElementById('mode-weight');
  modeBpBtn.classList.toggle('is-active', isBp);
  modeBpBtn.setAttribute('aria-selected', String(isBp));
  modeWBtn.classList.toggle('is-active', !isBp);
  modeWBtn.setAttribute('aria-selected', String(!isBp));
}

function openEntryDialog(mode = 'bp', recordToEdit = null) {
  const dialog = document.getElementById('entry-dialog');
  const form = document.getElementById('entry-form');
  const feedback = document.getElementById('entry-feedback');
  const warnBox = document.getElementById('confirm-warning-box');

  form.reset();
  feedback.textContent = '';
  feedback.className = 'feedback-box';
  warnBox.hidden = true;
  state.pendingWarningConfirmed = false;
  state.editingRecord = recordToEdit;

  const effectiveMode = recordToEdit ? recordToEdit.type : mode;
  setEntryMode(effectiveMode);

  document.getElementById('entry-dialog-title').textContent = recordToEdit ? 'Editar medición' : 'Nueva medición';
  document.getElementById('field-timestamp').value = toDatetimeLocalValue(recordToEdit ? recordToEdit.timestamp : new Date());
  document.getElementById('field-arm').value = recordToEdit?.arm || getRememberedArm();
  document.getElementById('field-position').value = recordToEdit?.position || getRememberedPosition();

  if (recordToEdit) {
    if (recordToEdit.type === 'bp') {
      document.getElementById('field-sys').value = recordToEdit.sys;
      document.getElementById('field-dia').value = recordToEdit.dia;
      document.getElementById('field-bpm').value = recordToEdit.bpm;
      document.getElementById('field-session-index').value = recordToEdit.sessionReadingIndex || 1;
    } else {
      document.getElementById('field-weight').value = Number(recordToEdit.weightKg).toFixed(1).replace('.', ',');
    }
    document.getElementById('field-notes').value = recordToEdit.notes || '';
  } else {
    document.getElementById('field-session-index').value = 1;
  }

  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }

  const firstInput = effectiveMode === 'bp' ? document.getElementById('field-sys') : document.getElementById('field-weight');
  firstInput.focus();
}

function closeEntryDialog() {
  const dialog = document.getElementById('entry-dialog');
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

function wireFastNumericAdvance() {
  const sysInput = document.getElementById('field-sys');
  const diaInput = document.getElementById('field-dia');
  const bpmInput = document.getElementById('field-bpm');

  const advanceIfReady = (input, nextInput) => {
    input.value = input.value.replace(/\D/g, '');
    if (input.value.length === 3) {
      nextInput.focus();
    }
  };

  sysInput.addEventListener('input', () => advanceIfReady(sysInput, diaInput));
  diaInput.addEventListener('input', () => advanceIfReady(diaInput, bpmInput));
  bpmInput.addEventListener('input', () => {
    bpmInput.value = bpmInput.value.replace(/\D/g, '');
  });
}

async function handleSaveEntry({ keepOpenForNext = false } = {}) {
  const feedback = document.getElementById('entry-feedback');
  const warnBox = document.getElementById('confirm-warning-box');
  const warnText = document.getElementById('confirm-warning-text');

  const candidate = buildRecordFromForm(state.editingRecord);
  if (!candidate.id) {
    candidate.id = createUuid();
  }

  const check = validateReading(candidate);
  if (!check.valid) {
    feedback.className = 'feedback-box feedback-box--error';
    feedback.textContent = check.errors.join(' ');
    return;
  }

  if (check.warnings.length > 0 && !state.pendingWarningConfirmed) {
    feedback.className = 'feedback-box feedback-box--warn';
    feedback.textContent = 'Revisa el aviso antes de guardar:';
    warnText.textContent = check.warnings.join(' ');
    warnBox.hidden = false;
    return;
  }

  if (candidate.type === 'bp') {
    rememberBpContext(candidate.arm, candidate.position);
  }

  await putReading(candidate);
  await reloadAllData();

  if (keepOpenForNext) {
    const nextIdx = (Number(document.getElementById('field-session-index').value) || 1) + 1;
    openEntryDialog(candidate.type, null);
    document.getElementById('field-session-index').value = nextIdx;
  } else {
    closeEntryDialog();
    refreshCurrentTab();
  }
}

function getStatsFilterOptions() {
  return {
    range: Number(document.getElementById('stats-range')?.value || 14),
    aggregation: document.getElementById('stats-aggregation')?.value || 'individual',
    condition: document.getElementById('stats-condition')?.value || 'all',
    timeWindow: document.getElementById('stats-timewindow')?.value || 'all',
    excludeFirstDay: Boolean(document.getElementById('stats-exclude-first-day')?.checked)
  };
}

function getHistoryFilterOptions() {
  return {
    from: document.getElementById('filter-from')?.value || '',
    to: document.getElementById('filter-to')?.value || '',
    type: document.getElementById('filter-type')?.value || 'all',
    condition: document.getElementById('filter-condition')?.value || 'all'
  };
}

function refreshCurrentTab() {
  if (state.activeTab === 'dashboard') {
    renderDashboard(state.readings, state.targets);
  } else if (state.activeTab === 'history') {
    renderHistory(state.readings, getHistoryFilterOptions(), {
      onEdit: (rec) => openEntryDialog(rec.type, rec),
      onDelete: async (rec) => {
        if (window.confirm('¿Eliminar este registro de forma permanente?')) {
          await deleteReading(rec.id);
          await reloadAllData();
          refreshCurrentTab();
        }
      }
    });
  } else if (state.activeTab === 'charts') {
    renderStatisticsTab(state.readings, getStatsFilterOptions(), state.targets);
  } else if (state.activeTab === 'report') {
    renderStatisticsTab(state.readings, getStatsFilterOptions(), state.targets);
    const fromDate = document.getElementById('report-from')?.value || '';
    const toDate = document.getElementById('report-to')?.value || '';
    renderMedicalReport(state.readings, { fromDate, toDate });
  } else if (state.activeTab === 'settings') {
    renderSettingsPanel();
  }
}

function renderSettingsPanel() {
  document.getElementById('target-sys').value = state.targets.sys ?? '';
  document.getElementById('target-dia').value = state.targets.dia ?? '';
  document.getElementById('target-bpm').value = state.targets.bpm ?? '';
  document.getElementById('target-weight').value = state.targets.weight ? String(state.targets.weight).replace('.', ',') : '';

  document.getElementById('reminder-enabled').checked = Boolean(state.reminders.enabled);
  document.getElementById('reminder-morning').value = state.reminders.morning || '08:00';
  document.getElementById('reminder-evening').value = state.reminders.evening || '20:00';

  document.getElementById('backup-alert-days').value = state.backupAlertDays;
  document.getElementById('maint-total-records').textContent = String(state.readings.length);
  document.getElementById('maint-last-record').textContent = state.readings[0] ? formatDateTimeEs(state.readings[0].timestamp) : 'Sin registros';
  document.getElementById('maint-last-backup').textContent = state.lastBackupAt ? formatDateTimeEs(state.lastBackupAt) : 'Nunca';

  const thresholdsText = document.getElementById('thresholds-summary-text');
  if (thresholdsText) {
    thresholdsText.textContent = `Umbrales configurados: SYS ≥ ${CLINICAL_THRESHOLDS.bpUrgentSys} o DIA ≥ ${CLINICAL_THRESHOLDS.bpUrgentDia} mmHg (aviso de repetición tras 5 min de reposo y 112 ante síntomas de alarma); SYS < ${CLINICAL_THRESHOLDS.bpLowSys} o DIA < ${CLINICAL_THRESHOLDS.bpLowDia} mmHg con síntomas asociados (consulta médica).`;
  }
}

function checkBackupBanner() {
  const banner = document.getElementById('backup-warning-banner');
  const textEl = document.getElementById('backup-warning-text');
  if (!banner || !textEl) return;

  if (state.readings.length === 0) {
    banner.hidden = true;
    return;
  }

  if (!state.lastBackupAt) {
    textEl.textContent = `Aún no has exportado ninguna copia JSON de tus mediciones (aviso configurado cada ${state.backupAlertDays} días).`;
    banner.hidden = false;
    return;
  }

  const daysSince = (Date.now() - new Date(state.lastBackupAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince > state.backupAlertDays) {
    textEl.textContent = `Han pasado ${Math.floor(daysSince)} días desde tu última copia JSON (umbral: ${state.backupAlertDays} días).`;
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

function checkReminderBanner() {
  const banner = document.getElementById('reminder-banner');
  const textEl = document.getElementById('reminder-banner-text');
  if (!banner || !textEl || !state.reminders.enabled) return;

  textEl.textContent = `Recordatorios configurados a las ${state.reminders.morning} y ${state.reminders.evening}. Recuerda realizar tu medición en reposo.`;
  banner.hidden = false;
}

async function handleImportJsonFile(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    window.alert('El archivo seleccionado no es un JSON válido.');
    return;
  }

  const validation = validateImportPayload(parsed);
  if (!validation.ok) {
    window.alert(`Error de validación: ${validation.error}`);
    return;
  }

  const incoming = validation.validRecords;
  const existingIds = new Set(state.readings.map((r) => r.id));
  const duplicates = incoming.filter((r) => existingIds.has(r.id));

  let mode = 'merge';
  if (duplicates.length > 0) {
    const mergeChoice = window.confirm(
      `Se detectaron ${duplicates.length} registro(s) duplicados por ID. Pulsa ACEPTAR para COMBINAR (actualizar duplicados y añadir nuevos) o CANCELAR para elegir si deseas REEMPLAZAR todo.`
    );
    if (!mergeChoice) {
      const replaceChoice = window.confirm('¿Deseas REEMPLAZAR por completo los datos actuales con el archivo importado?');
      if (!replaceChoice) return;
      mode = 'replace';
    }
  } else {
    const confirmImport = window.confirm(`¿Importar ${incoming.length} registro(s) desde JSON?`);
    if (!confirmImport) return;
  }

  await bulkPutReadings(incoming, { replace: mode === 'replace' });
  await reloadAllData();
  refreshCurrentTab();
  window.alert('Importación completada correctamente.');
}

async function reloadAllData() {
  const raw = await getAllReadings();
  const { readings } = groupIntoSessions(raw);
  state.readings = readings.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  state.targets = (await getSetting('targets', {})) || {};
  state.reminders = (await getSetting('reminders', { enabled: false, morning: '08:00', evening: '20:00' })) || {
    enabled: false,
    morning: '08:00',
    evening: '20:00'
  };
  state.backupAlertDays = Number(await getSetting('backupAlertDays', DEFAULT_BACKUP_ALERT_DAYS)) || DEFAULT_BACKUP_ALERT_DAYS;
  state.lastBackupAt = await getSetting('lastBackupAt', null);
  checkBackupBanner();
}

function bindEvents() {
  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.querySelectorAll('[data-open-entry]').forEach((btn) => {
    btn.addEventListener('click', () => openEntryDialog(btn.dataset.openEntry, null));
  });

  document.getElementById('mode-bp').addEventListener('click', () => setEntryMode('bp'));
  document.getElementById('mode-weight').addEventListener('click', () => setEntryMode('weight'));
  document.getElementById('btn-close-entry').addEventListener('click', closeEntryDialog);

  const guideDialog = document.getElementById('guide-dialog');
  document.getElementById('btn-open-guide').addEventListener('click', () => guideDialog.showModal());
  document.getElementById('btn-close-guide').addEventListener('click', () => guideDialog.close());
  document.getElementById('btn-guide-ok').addEventListener('click', () => guideDialog.close());

  document.getElementById('btn-confirm-warning').addEventListener('click', () => {
    state.pendingWarningConfirmed = true;
    handleSaveEntry({ keepOpenForNext: false });
  });

  document.getElementById('entry-form').addEventListener('submit', (e) => {
    e.preventDefault();
    handleSaveEntry({ keepOpenForNext: false });
  });

  document.getElementById('btn-save-and-add').addEventListener('click', () => {
    handleSaveEntry({ keepOpenForNext: true });
  });

  wireFastNumericAdvance();

  ['filter-from', 'filter-to', 'filter-type', 'filter-condition'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => refreshCurrentTab());
  });

  document.getElementById('btn-clear-filters')?.addEventListener('click', () => {
    document.getElementById('filter-from').value = '';
    document.getElementById('filter-to').value = '';
    document.getElementById('filter-type').value = 'all';
    document.getElementById('filter-condition').value = 'all';
    refreshCurrentTab();
  });

  ['stats-range', 'stats-aggregation', 'stats-condition', 'stats-timewindow', 'stats-exclude-first-day'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => refreshCurrentTab());
  });

  ['report-from', 'report-to'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => refreshCurrentTab());
  });

  document.getElementById('btn-print-report')?.addEventListener('click', () => {
    renderStatisticsTab(state.readings, getStatsFilterOptions(), state.targets);
    renderMedicalReport(state.readings, {
      fromDate: document.getElementById('report-from')?.value || '',
      toDate: document.getElementById('report-to')?.value || ''
    });
    window.print();
  });

  document.getElementById('btn-export-csv')?.addEventListener('click', () => {
    const filtered = filterReadings(state.readings, {
      fromDate: document.getElementById('report-from')?.value || null,
      toDate: document.getElementById('report-to')?.value || null
    });
    exportReadingsCsv(filtered);
  });

  document.getElementById('btn-export-json-report')?.addEventListener('click', async () => {
    exportReadingsJson(state.readings, SCHEMA_VERSION);
    const nowIso = toLocalIsoOffsetString(new Date());
    await setSetting('lastBackupAt', nowIso);
    state.lastBackupAt = nowIso;
    checkBackupBanner();
    renderSettingsPanel();
  });

  const shareBtn = document.getElementById('btn-share-report');
  if (shareBtn && typeof navigator.share === 'function') {
    shareBtn.hidden = false;
    shareBtn.addEventListener('click', async () => {
      try {
        await navigator.share({
          title: 'Informe HealthTrack',
          text: `Informe de mediciones registradas (${state.readings.length} registros).`
        });
      } catch {
        // Usuario canceló o no soportado en el contexto actual
      }
    });
  }

  document.getElementById('targets-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const targets = {
      sys: Number(document.getElementById('target-sys').value) || null,
      dia: Number(document.getElementById('target-dia').value) || null,
      bpm: Number(document.getElementById('target-bpm').value) || null,
      weight: parseDecimalInput(document.getElementById('target-weight').value)
    };
    if (Number.isNaN(targets.weight)) targets.weight = null;
    await setSetting('targets', targets);
    state.targets = targets;
    window.alert('Objetivos guardados.');
  });

  document.getElementById('reminders-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const reminders = {
      enabled: document.getElementById('reminder-enabled').checked,
      morning: document.getElementById('reminder-morning').value || '08:00',
      evening: document.getElementById('reminder-evening').value || '20:00'
    };
    await setSetting('reminders', reminders);
    state.reminders = reminders;
    checkReminderBanner();
    window.alert('Horarios de recordatorio guardados.');
  });

  document.getElementById('btn-request-notif')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('notif-permission-status');
    if (!('Notification' in window)) {
      statusEl.textContent = 'Estado del permiso: no soportado en este navegador (se usará aviso en la app).';
      return;
    }
    const perm = await Notification.requestPermission();
    statusEl.textContent = `Estado del permiso: ${perm}`;
  });

  document.getElementById('backup-alert-days')?.addEventListener('change', async (e) => {
    const days = Math.max(1, Number(e.target.value) || DEFAULT_BACKUP_ALERT_DAYS);
    await setSetting('backupAlertDays', days);
    state.backupAlertDays = days;
    checkBackupBanner();
  });

  document.getElementById('btn-export-backup')?.addEventListener('click', async () => {
    exportReadingsJson(state.readings, SCHEMA_VERSION);
    const nowIso = toLocalIsoOffsetString(new Date());
    await setSetting('lastBackupAt', nowIso);
    state.lastBackupAt = nowIso;
    checkBackupBanner();
    renderSettingsPanel();
  });

  document.getElementById('input-import-json')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      await handleImportJsonFile(file);
      e.target.value = '';
    }
  });

  document.getElementById('btn-go-settings-backup')?.addEventListener('click', () => switchTab('settings'));
  document.getElementById('btn-dismiss-reminder')?.addEventListener('click', () => {
    document.getElementById('reminder-banner').hidden = true;
  });
}

async function init() {
  registerServiceWorker();
  bindEvents();
  await reloadAllData();

  const storageInfo = await requestPersistentStorage();
  const badge = document.getElementById('storage-status-badge');
  const maintPersisted = document.getElementById('maint-storage-persisted');
  const statusText = storageInfo.persisted ? 'Almacenamiento persistente' : 'Almacenamiento local (no persistente)';
  if (badge) badge.textContent = statusText;
  if (maintPersisted) maintPersisted.textContent = storageInfo.persisted ? 'Sí (persistente)' : 'No garantizado por el navegador';

  checkReminderBanner();

  const savedTab = localStorage.getItem(PREF_KEYS.activeTab) || 'dashboard';
  switchTab(savedTab);
}

init().catch((error) => {
  console.error('No se pudo iniciar HealthTrack:', error);
  const main = document.getElementById('main-content');
  if (main) {
    const notice = document.createElement('div');
    notice.className = 'alert-card alert-card--urgent';
    notice.setAttribute('role', 'alert');
    notice.textContent = 'No se pudo iniciar la base de datos local. Comprueba que el navegador permite almacenamiento para este sitio y vuelve a cargar la aplicación. Tus datos existentes no se han eliminado.';
    main.prepend(notice);
  }
});