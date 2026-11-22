import { describe, expect, it } from 'vitest';
import { idsInContext, stripUnknownMentions } from './mentions.js';

describe('stripUnknownMentions', () => {
  it('drops mentions of ids that never appeared in the conversation', () => {
    const known = idsInContext('firestar4430 (@firestar4430, id: 446126627701915653, mention: <@446126627701915653>): hi');
    expect(stripUnknownMentions('sorry, rerouting to <@568860960738213905> instead 🌌', known)).toBe('sorry, rerouting to instead 🌌');
    expect(stripUnknownMentions('thanks <@!446126627701915653>', known)).toBe('thanks <@!446126627701915653>');
  });

  it('leaves channel and role mentions alone', () => {
    expect(stripUnknownMentions('see <#1506463404863389806>', new Set())).toBe('see <#1506463404863389806>');
  });
});
