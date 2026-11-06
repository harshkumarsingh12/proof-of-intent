/**
 * Keeps the shopper's key in IndexedDB (spec 0001). IndexedDB stores the CryptoKey object itself, so a
 * non-extractable key survives reloads without ever being exported. Browser only.
 */
import type { ShopperKey } from "./signing";

export interface StoredShopper {
  key: ShopperKey;
  /** From `POST /keys/shopper`; the Intent Mandate's `issuer` and the JWS `kid`. */
  kid: string;
  shopperId: string;
}

const DB = "poi-shopper";
const STORE = "keys";
const ID = "current";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) =>
    new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).finally(() => db.close()),
  );
}

export const loadShopper = (): Promise<StoredShopper | undefined> =>
  run<StoredShopper | undefined>("readonly", (s) => s.get(ID));

export const saveShopper = async (shopper: StoredShopper): Promise<void> => {
  await run("readwrite", (s) => s.put(shopper, ID));
};

/** "Use a new key": the old one is gone for good; mandates it signed stay valid on the server. */
export const forgetShopper = async (): Promise<void> => {
  await run("readwrite", (s) => s.delete(ID));
};
