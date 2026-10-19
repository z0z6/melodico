// Banki ustawień w IndexedDB: parametry (tempo, tonacja, efekty, deck, tryby kafelków)
// oraz próbki ze slotów REC. Track z decka nie jest zapisywany (jest za duży).

const DB_NAME = 'melodico';
const STORE = 'banks';

export const BANK_IDS = ['A', 'B', 'C', 'D'];

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('no-indexeddb'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb-open'));
    req.onblocked = () => reject(new Error('idb-blocked'));
  });
}

function run(mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const out = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(out && 'result' in out ? out.result : undefined);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error || new Error('idb-tx'));
        };
      })
  );
}

export function saveBank(id, bank) {
  return run('readwrite', (s) => s.put(bank, id));
}

export function loadBank(id) {
  return run('readonly', (s) => s.get(id));
}

/** Zwraca identyfikatory banków, które zawierają dane. */
export function listBanks() {
  return run('readonly', (s) => s.getAllKeys()).then((keys) => (keys || []).map(String));
}
