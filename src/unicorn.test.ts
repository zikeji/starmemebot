import { describe, expect, it } from 'vitest';
import { UnicornCooldown } from '../src/memes/unicorn.js';

const MINUTE = 60 * 1000;
const rollFourMessages = () => 0;
const rollTenMessages = () => 0.999;

describe('UnicornCooldown', () => {
  it('fires on the first unicorn in a channel', () => {
    expect(new UnicornCooldown().recordAndCheck('c1', 0, rollFourMessages)).toBe(true);
  });

  it('fires again after the rolled number of unicorn messages', () => {
    const cooldown = new UnicornCooldown();
    cooldown.recordAndCheck('c1', 0, rollFourMessages);
    for (let i = 0; i < 3; i++) expect(cooldown.recordAndCheck('c1', 0, rollFourMessages)).toBe(false);
    expect(cooldown.recordAndCheck('c1', 0, rollFourMessages)).toBe(true);
  });

  it('rolls at most 10 messages', () => {
    const cooldown = new UnicornCooldown();
    cooldown.recordAndCheck('c1', 0, rollTenMessages);
    for (let i = 0; i < 9; i++) expect(cooldown.recordAndCheck('c1', 0, rollTenMessages)).toBe(false);
    expect(cooldown.recordAndCheck('c1', 0, rollTenMessages)).toBe(true);
  });

  it('resets after 15 minutes regardless of message count', () => {
    const cooldown = new UnicornCooldown();
    cooldown.recordAndCheck('c1', 0, rollTenMessages);
    expect(cooldown.recordAndCheck('c1', 14 * MINUTE, rollTenMessages)).toBe(false);
    expect(cooldown.recordAndCheck('c1', 15 * MINUTE, rollTenMessages)).toBe(true);
  });

  it('tracks channels independently', () => {
    const cooldown = new UnicornCooldown();
    expect(cooldown.recordAndCheck('c1', 0, rollFourMessages)).toBe(true);
    expect(cooldown.recordAndCheck('c2', 0, rollFourMessages)).toBe(true);
    expect(cooldown.recordAndCheck('c1', 0, rollFourMessages)).toBe(false);
  });
});
