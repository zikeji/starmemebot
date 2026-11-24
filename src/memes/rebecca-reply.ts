import type { Client, Message } from 'discord.js';
import { MENTION_FACTS_PROMPT, matchesCorrectionTrigger } from '../corrections/facts.js';
import { installStringIssues } from '../corrections/install-string.js';
import { isCorrectionPost, startCorrectionCooldown } from '../corrections/watcher.js';
import { getHistoryContext } from '../history.js';
import { safeGenerateSpaceReply } from '../llm/rebecca.js';
import { root as log } from '../logger.js';
import { idsInContext, stripUnknownMentions } from './mentions.js';
import { rollBehavior } from './moods.js';
import { seasonalAccent, seasonalFlavor } from './seasonal.js';
import { isRebeccaSummoned } from './summon.js';
import type { Meme } from './types.js';

const TYPING_INTERVAL_MS = 8_000;

async function needsStarPilotFacts(message: Message): Promise<boolean> {
  if (matchesCorrectionTrigger(message.content)) return true;
  const repliedToId = message.reference?.messageId;
  return repliedToId ? isCorrectionPost(repliedToId) : false;
}

export const rebeccaReply: Meme = {
  name: 'rebecca-reply',
  shouldFire: (message, client) => isRebeccaSummoned(message, client),
  run: async (message: Message, client: Client) => {
    const history = await getHistoryContext(message.channel).catch(() => '');
    let typing = true;
    const keepTyping = (async () => {
      while (typing) {
        if (message.channel.isSendable()) await message.channel.sendTyping().catch(() => {});
        await new Promise((r) => setTimeout(r, TYPING_INTERVAL_MS));
      }
    })();
    try {
      const withFacts = await needsStarPilotFacts(message);
      const typos = installStringIssues(message.content);
      const typoPrompt = typos.length
        ? `Install string check (computed by code, reliable). Point out the exact mistake even if they asked about something else:\n${typos.map((t) => `- ${t}`).join('\n')}`
        : undefined;
      const flavor = [rollBehavior(), withFacts ? seasonalAccent() : seasonalFlavor()].filter(Boolean).join('\n\n');
      const facts = withFacts
        ? [MENTION_FACTS_PROMPT, typoPrompt, flavor && 'The mood or seasonal flavor below is a light touch on tone only (a short phrase or an emoji at most); the help comes first and the facts stay exact.']
        : [];
      const extraPrompt = [...facts, flavor].filter(Boolean).join('\n\n') || undefined;
      const outcome = await safeGenerateSpaceReply(history, {
        extraSystemPrompt: extraPrompt,
        client,
        triggerMessage: message,
      });
      if (outcome.kind === 'silent') return;
      const text = stripUnknownMentions(outcome.text, idsInContext(history));
      if (!text) return;
      const sent = await message.reply({ content: text, allowedMentions: { parse: [], repliedUser: true } });
      if (withFacts) startCorrectionCooldown(message.channelId);
      // Discord generates link previews even for named markdown links; suppress them.
      await sent.suppressEmbeds().catch((err) => log.warn({ err }, 'Failed to suppress embeds'));
    } finally {
      typing = false;
      await keepTyping;
    }
  },
};
