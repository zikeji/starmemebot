import type { Client, Message } from 'discord.js';
import { getHistoryContext } from '../history.js';
import { safeGenerateSpaceReply } from '../llm/rebecca.js';
import { root as log } from '../logger.js';

const TYPING_INTERVAL_MS = 8_000;

export async function replyAsRebecca(message: Message, client: Client, extraSystemPrompt?: string): Promise<Message | undefined> {
  const history = await getHistoryContext(message.channel).catch(() => '');
  let typing = true;
  const keepTyping = (async () => {
    while (typing) {
      if (message.channel.isSendable()) await message.channel.sendTyping().catch(() => {});
      await new Promise((r) => setTimeout(r, TYPING_INTERVAL_MS));
    }
  })();
  try {
    const outcome = await safeGenerateSpaceReply(history, {
      extraSystemPrompt,
      client,
      triggerMessage: message,
    });
    if (outcome.kind === 'silent') return undefined;
    const sent = await message.reply(outcome.text);
    // Discord generates link previews even for named markdown links; suppress them.
    await sent.suppressEmbeds().catch((err) => log.warn({ err }, 'Failed to suppress embeds'));
    return sent;
  } finally {
    typing = false;
    await keepTyping;
  }
}
