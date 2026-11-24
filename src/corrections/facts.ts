import { installStringIssues } from './install-string.js';

export const MIGRATION_WIKI_URL =
  'https://wiki.firestar.link/software/starpilot/#channel-names-and-the-one-time-migration';

const SUBMIT_FEEDBACK_CHANNEL_ID = '1506463404863389806';
const SHARE_ROUTE_COMMAND_ID = '1514546180896456804';

export const STARPILOT_7_FACTS = [
  'StarPilot 7.0 facts (from the maintainers):',
  '- StarPilot software versions are called "branches", never "update channels" or "release channels" (the device UI calls them branches). Discord channels are still channels.',
  '- The stable branch is `stable` (formerly `StarPilot`). The testing branch is `testing` (formerly `Dom`).',
  '- Existing installs on the old `Dom` or `StarPilot` branch switch to the new name once on their own. That is only for people already on one of them: never mention the old names or links to someone doing a fresh install, just give the new install string.',
  '- `dev` is the maintainer\'s personal branch, not for users.',
  '- Install strings: `starpilothq/stable` and `starpilothq/testing`. Always tell people to type it all lowercase, exactly as written.',
  '- The GitHub repo is `StarPilotHQ/StarPilot` (it moved from `firestar5683/StarPilot`). Other people have their own forks; a link to one is not a mistake and needs no correction.',
  `- Pull requests are opened against the \`stable\` branch so CI can check them, but merged changes go out on \`testing\` first. This is for people asking about PRs, not for guessing which branch has a model or feature. Once a PR is open, open a ticket in <#${SUBMIT_FEEDBACK_CHANNEL_ID}> to discuss it.`,
  '- Stuck on the boot logo or a loading screen, or an install keeps failing: try the reset first. Unplug the comma, wait 60 seconds, plug it back in and immediately tap the screen repeatedly until the reset prompt appears (comma 4: "reset & erase" then swipe; comma 3/3X: follow the Confirm prompts), then reinstall with the install string. A reset erases recordings and settings. Steps: [If You Cannot Open Settings](https://wiki.firestar.link/software/starpilot/#if-you-cannot-open-settings).',
  '- Flashing and recovery for StarPilot: https://flash.firestar.link installs StarPilot\'s AGNOS directly and has other recovery tools. Suggest it when a StarPilot user asks how to flash or recover, or the reset did not get them unstuck. Never correct people for having used flash.comma.ai or another flasher; those work too.',
  '- Leaving StarPilot (going back to stock openpilot or another fork): flash.firestar.link handles this too. Steps: open https://flash.firestar.link, under Recovery options check "Flash AGNOS", check "Other" under StarPilot Branch, enter `commaai` as the GitHub username and `master` as the branch (or the other fork\'s username and branch), and make sure "Delete old data" and "Install commaai (master)" are both checked.',
  '- Driving logs (steering, braking, AOL, fingerprinting): follow https://firestar.link/logs. In connect.comma.ai (signed in to the account the device is paired to), open the route, select the segments where it happened, then Files and upload next to "All logs". A route that has not shown up yet usually means the comma needs longer on Wi-Fi. If asked to make it public: More info -> Public access.',
  `- Where a route goes: if a [trusted helper] in the conversation asked for logs and did not ask for a ticket, share it right there with </share-route:${SHARE_ROUTE_COMMAND_ID}>. Otherwise, open a ticket in <#${SUBMIT_FEEDBACK_CHANNEL_ID}> with the route and the approximate minute. Logs should not be DMed, but only say so to someone who proposes a DM.`,
  '- StarPort connection problems use different logs from driving routes: Galaxy -> StarPort -> Connection Logs -> "Send StarPort logs" (or "Download all logs" and attach the zip to a ticket). Do not send someone with a StarPort connection problem to connect.comma.ai.',
  '- iPhone app problems: in the app, Settings -> Logs & support -> Report a problem on Discord.',
  '- The Bug Report form needs a real route ID and rejects anything else. If there is no route (the install never boots or never goes onroad), the Feedback form has no route field.',
  '- "Route rejected, older build than required" on a ticket: the drive was recorded on a build older than the fix. Update to the build the ticket asks for, drive again, and submit the new route; the date of the drive is not the problem.',
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
  /\broute\s?id\b/i,
];

const OTHER_FORK_LINK = /https?:\/\/(www\.)?github\.com\/(?!firestar5683\/)\S+/gi;

export function matchesCorrectionTrigger(rawContent: string): boolean {
  const content = rawContent.replace(OTHER_FORK_LINK, '');
  return TRIGGER_PATTERNS.some((pattern) => pattern.test(content)) || installStringIssues(content).length > 0;
}
