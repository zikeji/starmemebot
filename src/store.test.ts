import { describe, expect, it } from 'vitest';
import { createStore } from '../src/store.js';

describe('createStore', () => {
  it('isolates same-key entries across namespaces', async () => {
    const a = createStore<number>('ns-a');
    const b = createStore<number>('ns-b');
    await a.set('pending', 1);
    await b.set('pending', 2);
    expect(await a.get('pending')).toBe(1);
    expect(await b.get('pending')).toBe(2);
  });
});
