import { describe, expect, it } from 'vitest';
import { seasonalAccent, seasonalFlavor } from './memes/seasonal.js';

const at = (month: number, day: number) => new Date(2026, month - 1, day, 12);
const roll = (value: number) => () => value;

describe('seasonalFlavor', () => {
  it('stays quiet outside the seasons', () => {
    expect(seasonalFlavor(at(7, 4), roll(0))).toBeUndefined();
    expect(seasonalFlavor(at(11, 14), roll(0))).toBeUndefined();
    expect(seasonalFlavor(at(1, 1), roll(0))).toBeUndefined();
  });

  it('adds Halloween flavor through November 1st', () => {
    expect(seasonalFlavor(at(10, 3), roll(0))).toMatch(/Halloween/);
    expect(seasonalFlavor(at(11, 1), roll(0))).toMatch(/Halloween/);
    expect(seasonalFlavor(at(11, 2), roll(0))).toBeUndefined();
  });

  it('adds Thanksgiving flavor from November 15th through the 30th', () => {
    expect(seasonalFlavor(at(11, 15), roll(0))).toMatch(/Thanksgiving/);
    expect(seasonalFlavor(at(11, 30), roll(0))).toMatch(/Thanksgiving/);
  });

  it('is more likely on Thanksgiving Day, the fourth Thursday', () => {
    expect(seasonalFlavor(at(11, 25), roll(0.7))).toBeUndefined();
    expect(seasonalFlavor(at(11, 26), roll(0.7))).toMatch(/Thanksgiving/);
    expect(seasonalFlavor(new Date(2027, 10, 25, 12), roll(0.7))).toMatch(/Thanksgiving/);
    expect(seasonalFlavor(new Date(2027, 10, 26, 12), roll(0.7))).toBeUndefined();
    expect(seasonalFlavor(new Date(2028, 10, 23, 12), roll(0.7))).toMatch(/Thanksgiving/);
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

describe('seasonalAccent', () => {
  it('allows one emoji and none of the seasonal prose', () => {
    expect(seasonalAccent(at(11, 23), roll(0))).toBe('Seasonal accent: you may use one 🥧 emoji. No words about the season.');
    expect(seasonalAccent(at(12, 10), roll(0))).toContain('🎄');
    expect(seasonalAccent(at(7, 4), roll(0))).toBeUndefined();
  });
});
