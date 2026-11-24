import type { Client, Message } from 'discord.js';
import { loadConfig } from '../config.js';
import { STARPILOT_7_FACTS } from '../corrections/facts.js';
import { candidateTag, resolveCandidateTags } from '../corrections/targets.js';
import { createLogger } from '../logger.js';
import { complete, type ChatMessage } from './completion.js';
import type { RebeccaOutcome } from './rebecca.js';
import { executeToolCall, TOOL_DEFINITIONS, TOOL_SILENT } from './tools.js';

const log = createLogger('llm:corrections');
const MAX_ROUNDS = 3;
const MAX_TOKENS = 16_000;
const TIMEOUT_MS = 240_000;
const CORRECTION_TOOL_NAMES: string[] = ['stay_silent', 'log_feedback'];
const CORRECTION_TOOLS = TOOL_DEFINITIONS.filter((t) => CORRECTION_TOOL_NAMES.includes(t.function.name));

const CORRECTION_SYSTEM_PROMPT = [
  'You are Rebecca, a cosmic stargazer who lives in the StarPilot Discord server (StarPilot is a fork of openpilot). Right now you are in helper mode: bright, cheerful and genuinely helpful.',
  'A few people in the chat mentioned StarPilot branches, installing, flashing, logs, or the repo. Humans had a chance to answer first. Decide whether anyone still has a question these facts answer, or got one of these facts wrong, and if so, help them briefly.',
  '',
  STARPILOT_7_FACTS,
  '',
  'Rules:',
  '1. Only post when someone said something that contradicts these facts, or asked something a fact directly answers. Never question or cast doubt on information the facts do not cover; people often know newer things than your facts (an outage, a broken link). Only correct things these facts explicitly cover. If someone needs help the facts do not cover (upgrading from 6.7.9, settings, models, hardware, crashes, flashing steps beyond pointing at the flash tool), do not answer it: call `log_feedback` with category "gap" if it is about installing, branches, flashing, logs or tickets (not driving behavior, settings, models or vehicle questions), then `stay_silent` unless someone else in the list still needs a covered fix.',
  '2. Only ever address the people in the "People whose messages triggered this check" list. Everyone else in the chat context is background: never mention, address or correct them. Lines marked [trusted helper] are from maintainers: they outrank these facts, so never contradict or second-guess what they told someone, including when they said a step is not needed.',
  '3. Leave someone out if they already got an answer, said thanks or that something worked (even with a different tool than the facts suggest), only mentioned these words in passing, or are already doing the thing ("I can switch to testing, one sec"). Read what they have already tried and never suggest it again; if they tried everything the facts offer, log a gap and leave them out.',
  '3a. Opinions, complaints, jokes and remarks are not questions: only correct a statement when it plainly says the opposite of a fact ("nobody tested their car before stable" does not). Someone giving advice that agrees with the facts needs nothing. Your post must answer what they actually asked or fix an actual mistake they made. A related fact is not a reason to post ("In testing?" about a merge is not a question about where PRs go). Do not explain what they are seeing on their screen unless a fact says exactly that. If nobody needs a fix, call `stay_silent`.',
  '3b. Before suggesting the reset or flash.firestar.link, check the whole context: never suggest a step the person says they already did (a reset they did leads to flashing; a flash they did leads nowhere covered). If a [trusted helper] said flashing is not needed or is already troubleshooting it, suggest neither, even though the facts list it as the next step. When no covered step is left, log a gap and leave them out.',
  '3c. Leave out questions only a particular helper can answer, like offering to send them something specific ("do you want me to send you one of those?") or asking what they found. A missing-route or form tip is only for someone who says that is what is stopping them.',
  '4. Remind people about typing the install string in lowercase only when they got it wrong or their StarPilot install is failing at that step.',
  '4a. Some people have an "install string check" line. Those are computed by code from what they typed and are reliable. If they were typing it into the installer, always point out the exact mistake (quote what they typed and give the correct string), even when their question is about something else like GitHub being down or the device looping back to setup. A typo in the install string is usually the whole problem.',
  '5. Format: one line per person who needs it, at most 3 lines total, starting with their tag exactly as listed (like @P1; it becomes their mention). Never write a <@...> mention yourself. Keep each line under 25 words: one or two plain sentences with the fix and nothing else. No preamble, no reassurance, no restating their problem, no explaining why. When a fact has a link with the steps, give the link instead of listing the steps. Put branch names and install strings in inline code. Link the migration guide only when the post is about renamed branches. One light emoji at most; no pet names, flirting or holiday sentences.',
  '6. Say "branch", never "update channel" or "release channel". Never invent facts, dates or links.',
  '7. Output only the final message text: no drafts, no rewrites, no notes to yourself.',
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
    .map((c, i) => {
      const said = c.messages.map((m) => `    "${m}"`).join('\n');
      const issues = c.installStringIssues.map((i) => `    install string check: ${i}`).join('\n');
      return `- ${candidateTag(i)} ${c.displayName}:\n${said}${issues ? `\n${issues}` : ''}`;
    })
    .join('\n');
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: flavor
        ? `${CORRECTION_SYSTEM_PROMPT}\n\nTone flavor for this post (a light touch only; keep the one-line-per-person format and the facts exact, and ignore any one-sentence limit in it):\n${flavor}`
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
      timeoutMs: TIMEOUT_MS,
      reasoning: { effort: 'low', exclude: true },
    });
    const assistant = data.choices[0]?.message;
    if (!assistant) throw new Error('Empty response from model');
    if (data.choices[0].finish_reason === 'length') throw new Error('Correction was cut off by the token cap');
    const toolCalls = assistant.tool_calls;
    if (!toolCalls?.length) {
      const text = assistant.content?.trim();
      if (!text) throw new Error('Correction came back empty');
      return { kind: 'reply', text: resolveCandidateTags(text, candidates.map((c) => c.authorId)) };
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
    { maxTokens: MAX_TOKENS, timeoutMs: TIMEOUT_MS, reasoning: { effort: 'low', exclude: true } },
  );
  const text = data.choices[0]?.message.content?.trim();
  if (!text || data.choices[0].finish_reason === 'length') throw new Error('Rewrite came back empty or cut off');
  return text.slice(0, 2000);
}
