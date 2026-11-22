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
  ])('queues %s', (content) => expect(matchesCorrectionTrigger(content)).toBe(true));

  it.each([
    'Fairy tale is far and away the best big model lateral',
    'firestar deleted your car how does that make you feel',
    'my pedal throws propulsion errors',
    'domestic flights are cheap',
  ])('ignores %s', (content) => expect(matchesCorrectionTrigger(content)).toBe(false));
});
