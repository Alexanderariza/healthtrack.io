export const APP_NAME = 'HealthTrack';
export const SCHEMA_VERSION = 1;
export const DB_NAME = 'healthtrack_db';
export const DB_VERSION = 1;
export const CACHE_NAME = 'healthtrack-v1.0.0';
export const CHARTJS_VERSION = '4.4.7';

export const SESSION_WINDOW_MINUTES = 30;
export const DEFAULT_BACKUP_ALERT_DAYS = 7;

export const VALIDATION_BOUNDS = Object.freeze({
  sys: { min: 40, max: 300 },
  dia: { min: 20, max: 200 },
  bpm: { min: 20, max: 250 },
  weightKg: { min: 20, max: 350 }
});

export const PLAUSIBLE_WARNINGS = Object.freeze({
  sysLow: 80,
  sysHigh: 210,
  diaLow: 45,
  diaHigh: 130,
  bpmLow: 38,
  bpmHigh: 180,
  weightLow: 30,
  weightHigh: 250
});

// Constante única de alertas clínicas (no diagnósticas)
export const CLINICAL_THRESHOLDS = Object.freeze({
  bpUrgentSys: 180,
  bpUrgentDia: 120,
  bpLowSys: 90,
  bpLowDia: 60
});

export const PREF_KEYS = Object.freeze({
  lastArm: 'healthtrack_pref_last_arm',
  lastPosition: 'healthtrack_pref_last_position',
  activeTab: 'healthtrack_pref_active_tab'
});