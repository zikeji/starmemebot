import type { Client, Message } from 'discord.js';
import { loadConfig } from '../config.js';
import { STARPILOT_7_FACTS } from '../corrections/facts.js';
import { createLogger } from '../logger.js';
import { complete, type ChatMessage } from './completion.js';
import type { RebeccaOutcome } from './rebecca.js';
import { executeToolCall, TOOL_DEFINITIONS, TOOL_SILENT } from './tools.js';

const log = createLogger('llm:corrections');
const MAX_ROUNDS = 3;
const MAX_TOKENS = 800;
const CORRECTION_TOOL_NAMES: string[] = ['stay_silent', 'log_feedback'];
const CORRECTION_TOOLS = TOOL_DEFINITIONS.filter((t) => CORRECTION_TOOL_NAMES.includes(t.function.name));

const CORRECTION_SYSTEM_PROMPT = [
  'You are Rebecca, a cosmic stargazer who lives in the StarPilot Discord server (StarPilot is a fork of openpilot). Right now you are in helper mode: bright, cheerful and genuinely helpful.',
  'A few people in the chat mentioned StarPilot branches, installing, flashing, or the repo. Humans had a chance to answer first. Decide whether anyone is still confused or was told something wrong about the facts below, and if so, gently set it straight.',
  '',
  STARPILOT_7_FACTS,
  '',
  'Rules:',
  '1. Only correct things these facts explicitly cover. If someone needs help the facts do not cover (upgrading from 6.7.9, settings, models, hardware, crashes, flashing steps beyond pointing at the flash tool), do not answer it: call `log_feedback` with category "gap", then `stay_silent` unless someone else in the list still needs a covered fix.',
  '2. Only ever address the people in the "People whose messages triggered this check" list. Everyone else in the chat context is background: never mention, address or correct them, even if they said something that looks wrong (they may be a maintainer talking about their own setup, or it was already sorted out). A listed person who gave someone else a wrong answer about these facts can be corrected, kindly.',
  '3. If someone already got a correct answer, already said thanks or that something worked (even with a different tool than the facts suggest), or the message only mentions these words in passing (testing a feature, installing a dashcam, a person named Dom), leave them out. If nobody needs a fix, call `stay_silent`.',
  '4. Whenever someone names a branch, gets one wrong, or reports an install failing, remind them to type the install string all lowercase, exactly as written.',
  '4a. Some people have an "install string check" line. Those are computed by code from what they typed and are reliable. If they were typing it into the installer, always point out the exact mistake (quote what they typed and give the correct string), even when their question is about something else like GitHub being down or the device looping back to setup. A typo in the install string is usually the whole problem.',
  '5. Format: one short line per person who needs it, starting with their mention tag <@USER_ID>, at most 3 lines total. Put branch names and install strings in inline code (like `starpilothq/stable`). End with one link to the migration guide as a markdown link when it helps. Light emoji and a kaomoji are welcome; keep the uwu to a minimum so the fix is clear.',
  '6. Say "branch", never "update channel" or "release channel". Never invent facts, dates or links.',
  '7. Output only the message text.',
].join('\n');

export interface CorrectionCandidate {
  authorId: string;
  displayName: string;
  messages: string[];
  installStringIssues: string[];
}

export async function generateCorrection(
  client: Client,
  anchor: Message,
  chatContext: string,
  candidates: CorrectionCandidate[],
  flavor?: string,
): Promise<RebeccaOutcome> {
  const { openaiEndpoint, openaiApiKey, openaiModel } = loadConfig();
  const candidateList = candidates
    .map((c) => {
      const said = c.messages.map((m) => `    "${m}"`).join('\n');
      const issues = c.installStringIssues.map((i) => `    install string check: ${i}`).join('\n');
      return `- ${c.displayName} (mention: <@${c.authorId}>):\n${said}${issues ? `\n${issues}` : ''}`;
    })
    .join('\n');
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: flavor
        ? `${CORRECTION_SYSTEM_PROMPT}\n\nTone flavor for this post (tone only: keep the one-line-per-person format, the facts exact, and ignore any one-sentence limit in it):\n${flavor}`
        : CORRECTION_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: `Chat context:\n${chatContext}\n\nPeople whose messages triggered this check:\n${candidateList}\n\nTask: write the correction, or call stay_silent.`,
    },
  ];
  const toolCtx = {
    client,
    guildId: anchor.guildId!,
    viewerId: anchor.author.id,
    triggerChannelId: anchor.channelId,
    reactTarget: anchor,
    feedbackContext: chatContext,
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const data = await complete(openaiEndpoint, openaiApiKey, openaiModel, messages, CORRECTION_TOOLS, {
      maxTokens: MAX_TOKENS,
      reasoning: { effort: 'low', exclude: true },
    });
    const assistant = data.choices[0]?.message;
    if (!assistant) throw new Error('Empty response from model');
    const toolCalls = assistant.tool_calls;
    if (!toolCalls?.length) {
      const text = assistant.content?.trim();
      return text ? { kind: 'reply', text } : { kind: 'silent' };
    }
    messages.push(assistant);
    for (const call of toolCalls) {
      if (!CORRECTION_TOOL_NAMES.includes(call.function.name)) {
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'Error: that tool is not available here.' });
        continue;
      }
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'Error: invalid JSON arguments.' });
        continue;
      }
      const result = await executeToolCall(toolCtx, call.function.name, args);
      if (result === TOOL_SILENT) return { kind: 'silent' };
      log.info({ tool: call.function.name, resultPreview: result.slice(0, 200) }, 'Correction tool result');
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }
  log.warn('Correction ran out of tool rounds; staying silent');
  return { kind: 'silent' };
}

const REWRITE_SYSTEM_PROMPT = [
  'You are Rebecca, a bright and cheerful cosmic stargazer who helps out in the StarPilot Discord server.',
  'A server admin flagged one of your earlier messages as wrong and wrote a correction. Rewrite your message so it is accurate according to the correction.',
  'You are given the conversation your message was part of. Your rewritten message must still be a direct, relevant reply to the message you were answering; use the conversation to understand what was actually asked. Never turn it into a generic greeting.',
  'Keep your voice and roughly the same length. Keep any <@USER_ID> mentions and links that are still correct; drop ones the correction says are wrong. Do not mention that the message was corrected.',
  'Output only the new message text.',
].join('\n');

export async function rewriteWithCorrection(original: string, correction: string, conversation: string): Promise<string> {
  const { openaiEndpoint, openaiApiKey, openaiModel } = loadConfig();
  const data = await complete(
    openaiEndpoint,
    openaiApiKey,
    openaiModel,
    [
      { role: 'system', content: REWRITE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Conversation before your message:\n${conversation || '(unavailable)'}\n\nYour original message:\n${original}\n\nAdmin correction:\n${correction}`,
      },
    ],
    undefined,
    { maxTokens: MAX_TOKENS, reasoning: { effort: 'low', exclude: true } },
  );
  const text = data.choices[0]?.message.content?.trim();
  if (!text) throw new Error('Empty rewrite from model');
  return text.slice(0, 2000);
}
