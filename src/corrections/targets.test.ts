import { describe, expect, it } from 'vitest';
import { checkTargets } from './targets.js';

describe('checkTargets', () => {
  it('flags mentions of people outside the check', () => {
    expect(checkTargets('<@446126627701915653> the old `Dom` link still works', ['564862771599114240'])).toEqual({
      addressed: [],
      strays: ['446126627701915653'],
    });
  });

  it('accepts mentions of candidates in either mention form', () => {
    expect(checkTargets('<@1> use `stable`\n<@!2> type it lowercase', ['1', '2'])).toEqual({ addressed: ['1', '2'], strays: [] });
  });

  it('ignores channel and role mentions', () => {
    expect(checkTargets('<@1> open a ticket in <#99> or ask <@&77>', ['1'])).toEqual({ addressed: ['1'], strays: [] });
  });
});
