import { describe, expect, it } from 'vitest';
import { FALLOFF_MESSAGES, ReactionRoller, REACTION_EMOJI } from '../src/roller.js';

describe('ReactionRoller', () => {
  it('does not trigger twice within the falloff window', () => {
    const roller = new ReactionRoller();
    const always = () => 0; // always below TRIGGER_CHANCE
    expect(roller.recordAndRoll('c1', always)).not.toBeNull();
    for (let i = 0; i < FALLOFF_MESSAGES - 1; i++) {
      expect(roller.recordAndRoll('c1', always)).toBeNull();
    }
  });

  it('can trigger again once the falloff window has passed', () => {
    const roller = new ReactionRoller();
    const always = () => 0;
    expect(roller.recordAndRoll('c1', always)).not.toBeNull();
    for (let i = 0; i < FALLOFF_MESSAGES; i++) {
      roller.recordAndRoll('c1', always);
    }
    expect(roller.recordAndRoll('c1', always)).not.toBeNull();
  });

  it('tracks channels independently', () => {
    const roller = new ReactionRoller();
    const always = () => 0;
    expect(roller.recordAndRoll('c1', always)).not.toBeNull();
    expect(roller.recordAndRoll('c2', always)).not.toBeNull();
  });

  it('never triggers when rng is above the chance', () => {
    const roller = new ReactionRoller();
    for (let i = 0; i < 100; i++) {
      expect(roller.recordAndRoll('c1', () => 0.999)).toBeNull();
    }
  });

  it('returns valid reaction emoji pairs', () => {
    expect(REACTION_EMOJI['67']).toEqual(['6️⃣', '7️⃣']);
    expect(REACTION_EMOJI['69']).toEqual(['6️⃣', '9️⃣']);
  });
});
