const USER_MENTION = /<@!?(\d+)>/g;

export interface TargetCheck {
  addressed: string[];
  strays: string[];
}

export function checkTargets(text: string, candidateIds: string[]): TargetCheck {
  const mentioned = [...new Set([...text.matchAll(USER_MENTION)].map(([, id]) => id))];
  return {
    addressed: mentioned.filter((id) => candidateIds.includes(id)),
    strays: mentioned.filter((id) => !candidateIds.includes(id)),
  };
}
