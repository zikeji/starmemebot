import { describe, expect, it } from 'vitest';
import { matchesCorrectionTrigger } from './facts.js';

describe('matchesCorrectionTrigger', () => {
  it.each([
    'should I stay on dom or move?',
    'release means dom to stable?',
    'I typed StarPilotHQ/Stable and it failed',
    'the install link is firestar5683/StarPilot right?',
    'which branch do I pick',
    "it won't install on my c3",
    'starpilothq/stable goes to 10% then process starts over',
    'restarts at 45% every time',
    'flash.comma.ai says no compatible device found',
    'stuck on bootlogo after a fresh install',
    'zadig driver installed but still lost connection',
    'entered starpilothx/stabel',
    'Is there instructions how to grab a log',
    'How do i exportthe logs you need anddo i DM them to you?',
    'how do I send logs for my fingerprint',
    'I tried to create a bug report but it needs a routeid',
    'https://github.com/firestar5683/StarPilot',
  ])('queues %s', (content) => expect(matchesCorrectionTrigger(content)).toBe(true));

  it.each([
    'Fairy tale is far and away the best big model lateral',
    'firestar deleted your car how does that make you feel',
    'my pedal throws propulsion errors',
    'domestic flights are cheap',
    'I need to log in to galaxy again',
    'https://github.com/NanoMetere/StarPilot',
  ])('ignores %s', (content) => expect(matchesCorrectionTrigger(content)).toBe(false));
});
