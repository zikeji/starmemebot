import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Keyv from 'keyv';
import KeyvSqlite from '@keyv/sqlite';
import { createLogger } from './logger.js';

const log = createLogger('store');

const storePath = process.env.STORE_PATH || 'data/store.sqlite';
mkdirSync(dirname(storePath), { recursive: true });
const root = new KeyvSqlite({
  uri: `sqlite://${storePath}`,
  driver: 'better-sqlite3',
  clearExpiredInterval: 60 * 60 * 1000,
});

export interface StoreOptions {
  ttl?: number;
}

export interface Store<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, ttl?: number): Promise<unknown>;
  delete(key: string): Promise<boolean>;
}

export function createStore<T>(namespace: string, options: StoreOptions = {}): Store<T> {
  const keyv = new Keyv<T>({ store: root, ttl: options.ttl });
  keyv.on('error', err => log.error({ err }, `Keyv store error in namespace "${namespace}"`));
  // All stores share one adapter whose single `namespace` field each Keyv overwrites,
  // so same-key stores (e.g. two using 'pending') collide unless we prefix keys ourselves.
  const prefixed = (key: string): string => `${namespace}:${key}`;
  return {
    get: key => keyv.get(prefixed(key)),
    set: (key, value, ttl) => keyv.set(prefixed(key), value, ttl),
    delete: key => keyv.delete(prefixed(key)),
  };
}
