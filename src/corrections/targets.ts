const USER_MENTION = /<@!?(\d+)>/g;

export function candidateTag(index: number): string {
  return `@P${index + 1}`;
}

export function resolveCandidateTags(text: string, candidateIds: string[]): string {
  const resolved = text.replace(/@P(\d+)\b/g, (_tag, n: string) => {
    const id = candidateIds[Number(n) - 1];
    return id ? `<@${id}>` : '';
  });
  const [onlyId, ...others] = candidateIds;
  const needsMention = onlyId && others.length === 0 && resolved.match(USER_MENTION) === null;
  return needsMention ? `<@${onlyId}> ${resolved.trim().replace(/^@\S+\s+/, '')}` : resolved;
}

const MIN_WORDS = 3;

export function saysSomething(text: string): boolean {
  return (text.replace(USER_MENTION, '').match(/[\p{L}\p{N}]+/gu) ?? []).length >= MIN_WORDS;
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
