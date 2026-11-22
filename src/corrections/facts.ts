import { installStringIssues } from './install-string.js';

export const MIGRATION_WIKI_URL =
  'https://wiki.firestar.link/software/starpilot/#channel-names-and-the-one-time-migration';

const SUBMIT_FEEDBACK_CHANNEL_ID = '1506463404863389806';

export const STARPILOT_7_FACTS = [
  'StarPilot 7.0 facts (from the maintainers):',
  '- StarPilot software versions are called "branches", never "update channels" or "release channels" (the device UI calls them branches). Discord channels are still channels.',
  '- The stable branch is `stable` (formerly `StarPilot`). The testing branch is `testing` (formerly `Dom`).',
  '- The old `Dom` and `StarPilot` install links still work for existing installs, which switch over once on their own. Fresh installs should always use the new names.',
  '- `dev` is the maintainer\'s personal branch, not for users.',
  '- Install strings: `starpilothq/stable` and `starpilothq/testing`. Always tell people to type it all lowercase, exactly as written.',
  '- The GitHub repo is `StarPilotHQ/StarPilot` (it moved from `firestar5683/StarPilot`).',
  `- Pull requests target the \`stable\` branch. Once a PR is open, open a ticket in <#${SUBMIT_FEEDBACK_CHANNEL_ID}> to discuss it.`,
  '- Flashing and recovery for StarPilot: https://flash.firestar.link installs StarPilot\'s AGNOS directly and has other recovery tools. Suggest it when a StarPilot user asks how to flash or recover, is stuck on the boot logo, or a StarPilot install keeps failing after a few retries. Never correct people for having used flash.comma.ai or another flasher; those work too.',
  '- Leaving StarPilot (going back to stock openpilot or another fork): flash.firestar.link handles this too. Steps: open https://flash.firestar.link, under Recovery options check "Flash AGNOS", check "Other" under StarPilot Branch, enter `commaai` as the GitHub username and `master` as the branch (or the other fork\'s username and branch), and make sure "Delete old data" and "Install commaai (master)" are both checked.',
  `- Sharing logs: follow https://firestar.link/logs. In connect.comma.ai (signed in to the account the device is paired to), open the route, select the segments where it happened, then Files -> "upload all logs". Then open a ticket in <#${SUBMIT_FEEDBACK_CHANNEL_ID}> with the route and the approximate minute. Never DM logs to firestar or anyone else.`,
  '- To switch branches in Galaxy: Tools -> System Tools -> Software & Updates -> Advanced options -> Branch.',
  `- Wiki section for all of this: [the migration guide](${MIGRATION_WIKI_URL}).`,
].join('\n');

export const MENTION_FACTS_PROMPT = [
  STARPILOT_7_FACTS,
  'For questions about StarPilot branch names, install strings, the GitHub repo, where PRs go, flashing and recovery, or how to share logs, answer from these facts instead of calling search_wiki, and link the migration guide when it helps.',
  'Do not extend these facts: anything they do not cover (upgrading from 6.7.9, settings, models, hardware) still follows the usual wiki rules.',
].join('\n');

const TRIGGER_PATTERNS: RegExp[] = [
  /\bdom\b/i,
  /\bstable\b/i,
  /\btesting\b/i,
  /\bbranch(es)?\b/i,
  /\binstall(ed|ing|s|er|ation)?\b/i,
  /\bfirestar5683\b/i,
  /\bstarpilothq\b/i,
  /\/\s*(stable|testing|dom|starpilot)\b/i,
  /\b(won'?t|wont|can'?t|cant|doesn'?t|doesnt|didn'?t|didnt|fails?|failed|failing)\b.{0,40}\b(install|download)/i,
  /\b(restarts?|starts over|loops?)\b.{0,30}\d{1,3}\s?%/i,
  /\bflash(es|ed|ing)?\b/i,
  /\bboot\s?logo\b/i,
  /\b(zadig|qdl|qusb|agnos)\b/i,
  /\bbrick(ed)?\b/i,
  /\bfactory reset\b/i,
  /\b(send|share|upload|grab|get|export|submit|attach|pull|dm)\w*\b.{0,30}\b(logs?|routes?)\b/i,
  /\b(logs?|routes?)\b.{0,30}\b(how|where|instructions?)\b/i,
  /\bhow (do|can|should) (i|we|you)\b.{0,30}\blogs?\b/i,
  /connect\.comma\.ai/i,
  /\bshare-route\b/i,
];

export function matchesCorrectionTrigger(content: string): boolean {
  return TRIGGER_PATTERNS.some((pattern) => pattern.test(content)) || installStringIssues(content).length > 0;
}
