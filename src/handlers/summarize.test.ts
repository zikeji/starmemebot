import { describe, expect, it } from 'vitest';
import { buildSummaryEmbed, extractSummary } from './summarize.js';

const SHORT = 'A short summary.';
// Overflows the 4096-char description into overflow fields.
const LONG = 'x'.repeat(5000);
// Exceeds the entire 6000-char embed budget; tail must be dropped.
const HUGE = 'y'.repeat(8000);

describe('buildSummaryEmbed / extractSummary round-trip', () => {
  it('short summaries fit entirely in the description', () => {
    const embed = buildSummaryEmbed(SHORT, 'general');
    const data = embed.data;
    expect(data.description).toBe(SHORT);
    expect(data.fields ?? []).toHaveLength(0);
    expect(extractSummary(data)).toBe(SHORT);
  });

  it('long summaries round-trip through overflow fields', () => {
    const embed = buildSummaryEmbed(LONG, 'general');
    const data = embed.data;
    expect(data.description).toHaveLength(4096);
    expect(data.fields!.length).toBeGreaterThan(0);
    for (const field of data.fields!) {
      expect(field.name).toBe('_ _');
      expect(field.value.length).toBeLessThanOrEqual(1024);
      expect(field.inline).toBe(false);
    }
    expect(extractSummary(data)).toBe(LONG);
  });

  it('summaries beyond the embed budget are truncated with total chars under 6000', () => {
    const embed = buildSummaryEmbed(HUGE, 'general');
    const data = embed.data;
    const total =
      (data.description?.length ?? 0) +
      (data.fields ?? []).reduce((sum, f) => sum + f.value.length + f.name.length, 0) +
      (data.title?.length ?? 0);
    expect(total).toBeLessThanOrEqual(6000);
    const recovered = extractSummary(data);
    expect(HUGE.startsWith(recovered)).toBe(true);
    expect(recovered.length).toBeLessThan(HUGE.length);
  });

  it('round-trips the channel name in the title', () => {
    const embed = buildSummaryEmbed(SHORT, 'cars-and-threads');
    expect(embed.data.title).toBe('Summary of #cars-and-threads');
  });
});
