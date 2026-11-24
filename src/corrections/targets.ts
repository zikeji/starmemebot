const USER_MENTION = /<@!?(\d+)>/g;

export function candidateTag(index: number): string {
  return `{{P${index + 1}}}`;
}

export function resolveCandidateTags(text: string, candidateIds: string[]): string {
  return text.replace(/\{\{(?:P(\d+)|[^{}]*)\}\}/g, (_tag, n?: string) => {
    const id = candidateIds.length === 1 ? candidateIds[0] : candidateIds[Number(n) - 1];
    return id ? `<@${id}>` : '';
  });
}

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
