const USER_MENTION = /<@!?(\d+)>/g;

export function stripUnknownMentions(text: string, knownIds: Set<string>): string {
  return text
    .replace(USER_MENTION, (mention, id: string) => (knownIds.has(id) ? mention : ''))
    .replace(/ {2,}/g, ' ')
    .trim();
}

export function idsInContext(context: string): Set<string> {
  return new Set([...context.matchAll(/id: (\d+)/g)].map(([, id]) => id));
}
