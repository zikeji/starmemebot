import { describe, expect, it } from 'vitest';
import { seasonalFlavor } from './memes/seasonal.js';

const at = (month: number, day: number) => new Date(2026, month - 1, day, 12);
const roll = (value: number) => () => value;

describe('seasonalFlavor', () => {
  it('stays quiet outside the seasons', () => {
    expect(seasonalFlavor(at(7, 4), roll(0))).toBeUndefined();
    expect(seasonalFlavor(at(11, 21), roll(0))).toBeUndefined();
    expect(seasonalFlavor(at(1, 1), roll(0))).toBeUndefined();
  });

  it('adds Halloween flavor through November 1st', () => {
    expect(seasonalFlavor(at(10, 3), roll(0))).toMatch(/Halloween/);
    expect(seasonalFlavor(at(11, 1), roll(0))).toMatch(/Halloween/);
    expect(seasonalFlavor(at(11, 2), roll(0))).toBeUndefined();
  });

  it('adds holiday flavor all of December', () => {
    expect(seasonalFlavor(at(12, 1), roll(0))).toMatch(/December holiday/);
    expect(seasonalFlavor(at(12, 31), roll(0))).toMatch(/December holiday/);
  });

  it('is more likely on Christmas Eve and Christmas Day', () => {
    expect(seasonalFlavor(at(12, 10), roll(0.7))).toBeUndefined();
    expect(seasonalFlavor(at(12, 24), roll(0.7))).toMatch(/December holiday/);
    expect(seasonalFlavor(at(12, 25), roll(0.7))).toMatch(/December holiday/);
    expect(seasonalFlavor(at(12, 25), roll(0.9))).toBeUndefined();
  });

  it('keeps the higher chance on Halloween night', () => {
    expect(seasonalFlavor(at(10, 30), roll(0.7))).toBeUndefined();
    expect(seasonalFlavor(at(10, 31), roll(0.7))).toMatch(/Halloween/);
  });
});
