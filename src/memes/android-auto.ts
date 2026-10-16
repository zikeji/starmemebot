import type { Message } from 'discord.js';
import { createLogger } from '../logger.js';
import { createStore } from '../store.js';
import { replyAsRebecca } from './reply.js';
import type { Meme } from './types.js';

const log = createLogger('android-auto');
const TRIGGER = /\bandroid[\s-]*auto\b/i;
const COOLDOWN_MS = 10 * 60 * 1000;
const REPLY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ANNOUNCEMENT_URL = 'https://discord.com/channels/1387432184121393333/1492668829904408596/1560460955153076256';

const ANDROID_AUTO_PROMPT = [
  'Meme override: someone just brought up Android Auto, the hottest topic in the server since the StarPilot 7.0 announcement. Everyone keeps asking about it and the answer is basically always the same, so this is a running bit: be the helpful oracle who has answered this a thousand times.',
  'Facts (from the maintainers). These override the usual search-the-wiki-and-never-explain rule: for Android Auto questions, answer directly from these facts instead of calling search_wiki.',
  '- StarPilot 7.0 is a standalone rebase onto the latest openpilot master. Native Android Auto support is one of its headline features, built by yummydirt and di31.',
  '- The comma device itself acts as the Android phone: it emulates what a phone sends and connects straight to the car\'s head unit, then shows the StarPilot UI on the car screen. No phone, no app, no Google approval needed.',
  '- It is Android Auto only. CarPlay is not a thing here, but iPhone owners can still use it because the phone is not involved at all.',
  '- Right now it runs wirelessly on head units that support wireless Android Auto. Wired support exists in the code but is disabled for now (the USB-C port is wanted for eGPU/Jetlink); the devs are exploring enabling it when no eGPU/Jetlink is attached.',
  '- Head unit only does wired Android Auto? A wireless AA dongle (around $20) bridges it. The Motorola MA01 is confirmed working and is what firestar uses; AAWireless and Carlinkit get community recommendations too.',
  '- Most head units run one Android Auto session at a time, so StarPilot takes that slot instead of the phone. Bluetooth music from the phone can still work if the car supports multiple Bluetooth devices.',
  '- Release status: 7.0 is NOT on dom or release yet. Plan is devs and guinea pigs first, then a wider tester call, then dom, then release. There is NO date; "Soon™" and "when the stars align" are the only official ETAs. Never invent one.',
  '- Existing testers send feedback in <#1560655602328277032>. Do not hand out branch names or encourage newcomers to install early; firestar wants first impressions to be good.',
  `- When it fits (especially "what is this" or "when" questions), link the 7.0 announcement as a markdown link like [the announcement](${ANNOUNCEMENT_URL}).`,
  'People who speak authoritatively about Android Auto. Identify them by the id shown in chat history, never by display name, since anyone can copy a name (if they say something newer in chat, trust them over these facts):',
  '- di31_ (id 420178305073938433), co-built the Android Auto support.',
  '- firestar4430 (id 446126627701915653), the StarPilot maintainer.',
  '- Nik (id 168046351056240640), StarPilot Sage.',
  '- yummydirt (id 247148904003403776), co-built the Android Auto support.',
  '- pra0485 (id 575437532976775198), StarPilot Sage who has tested it in depth.',
  'Only use their <@id> mention when pointing someone to ask them directly; otherwise credit them by plain name so they are not pinged every time Android Auto comes up.',
  'Memory: call search_memories for "Android Auto" first; newer details may have been stored since these facts were written. When one of the people above shares new or corrected Android Auto info (release status, wired support, dongles, quirks), store_memory or update_memory it even if nobody asked (with their id in relevant_user_ids), so the next answer is current.',
  'Deliver it in character: one sentence, answer whatever was actually asked using these facts, with a wink at how many times the stars have heard this question. Playful, never mean to whoever asked.',
].join('\n');

export class ChannelCooldown {
  private lastFired = new Map<string, number>();

  constructor(private cooldownMs: number) {}

  isReady(channelId: string, now: number = Date.now()): boolean {
    const last = this.lastFired.get(channelId);
    return last === undefined || now - last >= this.cooldownMs;
  }

  start(channelId: string, now: number = Date.now()): void {
    this.lastFired.set(channelId, now);
  }
}

const cooldown = new ChannelCooldown(COOLDOWN_MS);

export const mentionsAndroidAuto = (content: string): boolean => TRIGGER.test(content);

const androidAutoReplies = createStore<true>('android-auto-replies', { ttl: REPLY_TTL_MS });

export async function rememberAndroidAutoReply(reply: Pick<Message, 'id' | 'channelId'>): Promise<void> {
  cooldown.start(reply.channelId);
  await androidAutoReplies
    .set(reply.id, true)
    .catch((err) => log.error({ err }, 'Failed to store Android Auto reply id'));
}

export async function isAndroidAutoReply(messageId: string): Promise<boolean> {
  const stored = await androidAutoReplies.get(messageId).catch((err) => {
    log.warn({ err }, 'Failed to look up Android Auto reply id');
    return undefined;
  });
  return stored === true;
}

export async function androidAutoContextFor(message: Message): Promise<string | undefined> {
  if (mentionsAndroidAuto(message.content)) return ANDROID_AUTO_PROMPT;
  const repliedToId = message.reference?.messageId;
  if (!repliedToId) return undefined;
  if (await isAndroidAutoReply(repliedToId)) return ANDROID_AUTO_PROMPT;
  const repliedTo = await message.fetchReference().catch(() => undefined);
  return repliedTo && mentionsAndroidAuto(repliedTo.content) ? ANDROID_AUTO_PROMPT : undefined;
}

export const androidAuto: Meme = {
  name: 'android-auto',
  shouldFire: (message) => mentionsAndroidAuto(message.content) && cooldown.isReady(message.channelId),
  run: async (message, client) => {
    cooldown.start(message.channelId);
    log.info({ channelId: message.channelId }, 'Unprompted Android Auto reply triggered');
    const sent = await replyAsRebecca(message, client, ANDROID_AUTO_PROMPT);
    if (sent) await rememberAndroidAutoReply(sent);
  },
};
