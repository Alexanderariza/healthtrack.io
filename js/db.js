import { DB_NAME, DB_VERSION, SCHEMA_VERSION } from './config.js';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const oldVersion = event.oldVersion;

      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains('readings')) {
          const store = db.createObjectStore('readings', { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('type', 'type', { unique: false });
          store.createIndex('sessionId', 'sessionId', { unique: false });
        }

        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Error abriendo IndexedDB'));
  });
}

function runTx(storeName, mode, callback) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let result;
        try {
          result = callback(store);
        } catch (err) {
          reject(err);
          return;
        }
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error('Error en transacción IndexedDB'));
      })
  );
}

export function createUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function toLocalIsoOffsetString(dateInput = new Date()) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const offH = pad(offsetMin / 60);
  const offM = pad(offsetMin % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${offH}:${offM}`;
}

export async function getAllReadings() {
  const rows = await runTx(
    'readings',
    'readonly',
    (store) =>
      new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      })
  );
  return rows.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

export async function putReading(record) {
  const nowIso = toLocalIsoOffsetString(new Date());
  const normalized = {
    ...record,
    schemaVersion: SCHEMA_VERSION,
    createdAt: record.createdAt || nowIso,
    updatedAt: nowIso
  };
  await runTx('readings', 'readwrite', (store) => store.put(normalized));
  return normalized;
}

export async function deleteReading(id) {
  await runTx('readings', 'readwrite', (store) => store.delete(id));
}

export async function bulkPutReadings(records, { replace = false } = {}) {
  const nowIso = toLocalIsoOffsetString(new Date());
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('readings', 'readwrite');
    const store = tx.objectStore('readings');
    if (replace) {
      store.clear();
    }
    for (const r of records) {
      store.put({
        ...r,
        schemaVersion: SCHEMA_VERSION,
        createdAt: r.createdAt || nowIso,
        updatedAt: nowIso
      });
    }
    tx.oncomplete = () => resolve(records.length);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getSetting(key, defaultValue = null) {
  const row = await runTx(
    'settings',
    'readonly',
    (store) =>
      new Promise((resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      })
  );
  return row ? row.value : defaultValue;
}

export async function setSetting(key, value) {
  await runTx('settings', 'readwrite', (store) => store.put({ key, value }));
}

export async function requestPersistentStorage() {
  if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.persist === 'function') {
    const granted = await navigator.storage.persist();
    const persisted = typeof navigator.storage.persisted === 'function' ? await navigator.storage.persisted() : granted;
    return { supported: true, persisted: Boolean(persisted) };
  }
  return { supported: false, persisted: false };
}