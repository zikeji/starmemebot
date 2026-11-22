import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CorrectionScheduler, type DroppedCheck, type FiredCheck } from './scheduler.js';

const SECOND = 1000;

function setup() {
  const fired: FiredCheck[] = [];
  const dropped: DroppedCheck[] = [];
  const scheduler = new CorrectionScheduler({ onFire: (c) => fired.push(c), onDrop: (c) => dropped.push(c) });
  return { scheduler, fired, dropped };
}

const authors = (check: FiredCheck) => check.entries.map((e) => e.authorId);

function holdOpenUntilCap(scheduler: CorrectionScheduler, channelId: string): void {
  for (let i = 0; i < 8; i++) {
    vi.advanceTimersByTime(20 * SECOND);
    scheduler.bump(channelId);
  }
  vi.advanceTimersByTime(15 * SECOND);
}

describe('CorrectionScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it('fires 60s after the first trigger when nobody talks', () => {
    const { scheduler, fired } = setup();
    scheduler.trigger('c1', 'a', 'm1');
    vi.advanceTimersByTime(59 * SECOND);
    expect(fired).toHaveLength(0);
    vi.advanceTimersByTime(SECOND);
    expect(fired.map(authors)).toEqual([['a']]);
  });

  it('raises the remaining wait to 30s on a human message but never lowers it', () => {
    const { scheduler, fired } = setup();
    scheduler.trigger('c1', 'a', 'm1');
    vi.advanceTimersByTime(10 * SECOND);
    scheduler.bump('c1');
    vi.advanceTimersByTime(50 * SECOND);
    expect(fired).toHaveLength(1);

    scheduler.trigger('c2', 'a', 'm2');
    vi.advanceTimersByTime(50 * SECOND);
    scheduler.bump('c2');
    vi.advanceTimersByTime(29 * SECOND);
    expect(fired).toHaveLength(1);
    vi.advanceTimersByTime(SECOND);
    expect(fired).toHaveLength(2);
  });

  it('never waits past the 3 minute cap', () => {
    const { scheduler, fired } = setup();
    scheduler.trigger('c1', 'a', 'm1');
    for (let i = 0; i < 17; i++) {
      vi.advanceTimersByTime(10 * SECOND);
      scheduler.bump('c1');
    }
    vi.advanceTimersByTime(10 * SECOND - 1);
    expect(fired).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(fired).toHaveLength(1);
  });

  it('collects several authors into one check and folds repeat triggers', () => {
    const { scheduler, fired } = setup();
    scheduler.trigger('c1', 'a', 'm1');
    vi.advanceTimersByTime(5 * SECOND);
    scheduler.trigger('c1', 'b', 'm2');
    scheduler.trigger('c1', 'a', 'm3');
    vi.advanceTimersByTime(60 * SECOND);
    expect(fired).toHaveLength(1);
    expect(fired[0].entries.find((e) => e.authorId === 'a')?.messageIds).toEqual(['m1', 'm3']);
    expect(authors(fired[0]).sort()).toEqual(['a', 'b']);
  });

  it('carries late joiners into a fresh check with their own window', () => {
    const { scheduler, fired } = setup();
    scheduler.trigger('c1', 'a', 'm1');
    holdOpenUntilCap(scheduler, 'c1');
    scheduler.trigger('c1', 'b', 'm2');
    vi.advanceTimersByTime(5 * SECOND);
    expect(fired.map(authors)).toEqual([['a']]);
    vi.advanceTimersByTime(55 * SECOND);
    expect(fired.map(authors)).toEqual([['a'], ['b']]);
  });

  it('drops a check once every author is removed and reports why', () => {
    const { scheduler, fired, dropped } = setup();
    scheduler.trigger('c1', 'a', 'm1');
    scheduler.trigger('c1', 'b', 'm2');
    scheduler.remove('c1', 'a', 'trusted-answer');
    expect(dropped).toHaveLength(0);
    scheduler.remove('c1', 'b', 'mentioned-rebecca');
    vi.advanceTimersByTime(200 * SECOND);
    expect(fired).toHaveLength(0);
    expect(dropped[0].removed.map((r) => r.reason)).toEqual(['trusted-answer', 'mentioned-rebecca']);
  });

  it('fires only for the authors left after a partial cancel', () => {
    const { scheduler, fired } = setup();
    scheduler.trigger('c1', 'a', 'm1');
    scheduler.trigger('c1', 'b', 'm2');
    scheduler.remove('c1', 'a', 'trusted-answer');
    vi.advanceTimersByTime(60 * SECOND);
    expect(fired.map(authors)).toEqual([['b']]);
    expect(fired[0].removed).toEqual([{ authorId: 'a', reason: 'trusted-answer' }]);
  });

  it('drops new triggers during the channel cooldown but lets carried checks fire', () => {
    const { scheduler, fired } = setup();
    scheduler.startCooldown('c1');
    scheduler.trigger('c1', 'a', 'm1');
    vi.advanceTimersByTime(4 * 60 * SECOND);
    expect(fired).toHaveLength(0);
    vi.advanceTimersByTime(60 * SECOND);
    scheduler.trigger('c1', 'a', 'm2');
    vi.advanceTimersByTime(60 * SECOND);
    expect(fired).toHaveLength(1);

    scheduler.trigger('c2', 'a', 'm3');
    holdOpenUntilCap(scheduler, 'c2');
    scheduler.trigger('c2', 'b', 'm4');
    vi.advanceTimersByTime(5 * SECOND);
    scheduler.startCooldown('c2');
    vi.advanceTimersByTime(60 * SECOND);
    expect(fired.slice(1).map(authors)).toEqual([['a'], ['b']]);
  });

  it('still bumps an open check when a trigger arrives during cooldown', () => {
    const { scheduler, fired } = setup();
    scheduler.trigger('c1', 'a', 'm1');
    vi.advanceTimersByTime(50 * SECOND);
    scheduler.startCooldown('c1');
    scheduler.trigger('c1', 'b', 'm2');
    vi.advanceTimersByTime(29 * SECOND);
    expect(fired).toHaveLength(0);
    vi.advanceTimersByTime(SECOND);
    expect(fired.map(authors)).toEqual([['a']]);
  });

  it('accepts triggers again once the cooldown is cleared', () => {
    const { scheduler, fired } = setup();
    scheduler.startCooldown('c1');
    scheduler.clearCooldown('c1');
    scheduler.trigger('c1', 'a', 'm1');
    vi.advanceTimersByTime(60 * SECOND);
    expect(fired).toHaveLength(1);
  });

  it('keeps channels independent', () => {
    const { scheduler, fired } = setup();
    scheduler.trigger('c1', 'a', 'm1');
    vi.advanceTimersByTime(30 * SECOND);
    scheduler.trigger('c2', 'b', 'm2');
    vi.advanceTimersByTime(30 * SECOND);
    expect(fired.map((f) => f.channelId)).toEqual(['c1']);
  });
});
