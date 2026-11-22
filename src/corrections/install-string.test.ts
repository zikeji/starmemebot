import { describe, expect, it } from 'vitest';
import { installStringIssues } from './install-string.js';

describe('installStringIssues', () => {
  it('catches a misspelled owner', () => {
    const [issue] = installStringIssues("when I enter in starpilohq/stable, it'll download");
    expect(issue).toContain('"starpilohq" is misspelled, it should be "starpilothq"');
  });

  it('catches a capitalized branch but not a capitalized owner', () => {
    expect(installStringIssues('I typed StarPilotHQ/Stable')).toEqual([
      'typed "StarPilotHQ/Stable": "Stable" should be all lowercase: "stable"',
    ]);
    expect(installStringIssues('StarPilotHQ/stable worked')).toEqual([]);
  });

  it('catches old branch names and misspelled branches', () => {
    expect(installStringIssues('starpilothq/dom')[0]).toContain('install with "testing"');
    expect(installStringIssues('starpilothq/stabel')[0]).toContain('"stabel" is misspelled, it should be "stable"');
  });

  it('accepts correct strings and ignores unrelated slashes', () => {
    expect(installStringIssues('starpilothq/stable and starpilothq/testing')).toEqual([]);
    expect(installStringIssues('https://flash.firestar.link and and/or 10/10 commaai/openpilot')).toEqual([]);
  });
});
