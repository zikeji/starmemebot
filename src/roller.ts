export const TRIGGER_CHANCE = 0.001;
export const FALLOFF_MESSAGES = 5;

export type MemeReaction = '67' | '69';

export const REACTION_EMOJI: Record<MemeReaction, string[]> = {
  '67': ['6️⃣', '7️⃣'],
  '69': ['6️⃣', '9️⃣'],
};

export class ReactionRoller {
  private sinceLastTrigger = new Map<string, number>();

  constructor(private triggerChance: number = TRIGGER_CHANCE) {}

  recordAndRoll(channelId: string, rng: () => number = Math.random): MemeReaction | null {
    const since = this.sinceLastTrigger.get(channelId) ?? FALLOFF_MESSAGES;
    const triggered = since >= FALLOFF_MESSAGES && rng() < this.triggerChance;
    if (triggered) {
      this.sinceLastTrigger.set(channelId, 0);
      return rng() < 0.5 ? '67' : '69';
    }
    this.sinceLastTrigger.set(channelId, since + 1);
    return null;
  }
}
