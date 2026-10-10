// IndexedDB: обёртка на промисах и миграции схемы.
// Схема по CLAUDE.md: occurrence, fact, event, classification, link, action, qa.

export const DB_NAME = 'soam-investigator';
export const DB_VERSION = 1;
export const STORES = ['occurrence', 'fact', 'event', 'classification', 'link', 'action', 'qa'];

// Хранилища, привязанные к делу через occurrenceId (для каскадного удаления и экспорта).
const CHILD_STORES = ['fact', 'event', 'classification', 'link', 'action'];

// MIGRATIONS[n] переводит схему с версии n на n+1. Старые миграции не менять — добавлять новые.
const MIGRATIONS = [
  // 0 → 1: исходная схема
  (db) => {
    const occ = db.createObjectStore('occurrence', { keyPath: 'id' });
    occ.createIndex('status', 'status');

    const fact = db.createObjectStore('fact', { keyPath: 'id' });
    fact.createIndex('occurrenceId', 'occurrenceId');

    const ev = db.createObjectStore('event', { keyPath: 'id' });
    ev.createIndex('occurrenceId', 'occurrenceId');

    const cls = db.createObjectStore('classification', { keyPath: 'id' });
    cls.createIndex('occurrenceId', 'occurrenceId');
    cls.createIndex('factId', 'factId');

    const link = db.createObjectStore('link', { keyPath: 'id' });
    link.createIndex('occurrenceId', 'occurrenceId');
    link.createIndex('fromId', 'fromId');
    link.createIndex('toId', 'toId');

    const act = db.createObjectStore('action', { keyPath: 'id' });
    act.createIndex('occurrenceId', 'occurrenceId');

    db.createObjectStore('qa', { keyPath: 'occurrenceId' });
  },
];

if (MIGRATIONS.length !== DB_VERSION) {
  throw new Error(`db.js: DB_VERSION=${DB_VERSION}, но миграций ${MIGRATIONS.length}`);
}

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export function newId() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** Открывает базу. name — для тестов (отдельная БД). */
export function openDB(name = DB_NAME, version = DB_VERSION) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, version);
    r.onupgradeneeded = (e) => {
      const db = r.result;
      for (let v = e.oldVersion; v < version; v++) MIGRATIONS[v](db, r.transaction);
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => db.close();
      resolve(new Store(db));
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('IndexedDB blocked: закройте другие вкладки приложения'));
  });
}

export function deleteDB(name) {
  return req(indexedDB.deleteDatabase(name));
}

export class Store {
  constructor(db) { this.db = db; }
  close() { this.db.close(); }

  get(store, key) {
    return req(this.db.transaction(store).objectStore(store).get(key));
  }
  all(store) {
    return req(this.db.transaction(store).objectStore(store).getAll());
  }
  byIndex(store, index, value) {
    return req(this.db.transaction(store).objectStore(store).index(index).getAll(value));
  }
  async put(store, obj) {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).put(obj);
    await done(tx);
    return obj;
  }
  async putMany(store, objs) {
    if (!objs.length) return;
    const tx = this.db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const o of objs) os.put(o);
    await done(tx);
  }
  async del(store, key) {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await done(tx);
  }
  async clear(store) {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    await done(tx);
  }

  /** Полный пакет дела — для экспорта/импорта в JSON и загрузки тестовых кейсов. */
  async exportOccurrence(id) {
    const occurrence = await this.get('occurrence', id);
    if (!occurrence) return null;
    const bundle = { schema: DB_VERSION, occurrence, qa: (await this.get('qa', id)) || null };
    for (const s of CHILD_STORES) bundle[s + 's'] = await this.byIndex(s, 'occurrenceId', id);
    return bundle;
  }

  /** Импорт пакета дела. Существующее дело с тем же id полностью заменяется. */
  async importOccurrence(bundle) {
    const occ = bundle.occurrence;
    if (!occ || !occ.id) throw new Error('importOccurrence: нет occurrence.id');
    await this.deleteOccurrence(occ.id);
    const tx = this.db.transaction(STORES, 'readwrite');
    tx.objectStore('occurrence').put(occ);
    for (const s of CHILD_STORES) {
      const os = tx.objectStore(s);
      for (const o of bundle[s + 's'] || []) os.put({ ...o, occurrenceId: occ.id });
    }
    if (bundle.qa) tx.objectStore('qa').put({ ...bundle.qa, occurrenceId: occ.id });
    await done(tx);
    return occ.id;
  }

  /** Каскадное удаление дела со всеми дочерними записями. */
  async deleteOccurrence(id) {
    const tx = this.db.transaction(STORES, 'readwrite');
    tx.objectStore('occurrence').delete(id);
    tx.objectStore('qa').delete(id);
    for (const s of CHILD_STORES) {
      const idx = tx.objectStore(s).index('occurrenceId');
      const r = idx.openKeyCursor(IDBKeyRange.only(id));
      r.onsuccess = () => {
        const c = r.result;
        if (c) { tx.objectStore(s).delete(c.primaryKey); c.continue(); }
      };
    }
    await done(tx);
  }
}

let _default;
/** Общая БД приложения (ленивое открытие). */
export async function db() {
  if (!_default) _default = await openDB();
  return _default;
}
