const OWNER = 'starpilothq';
const BRANCHES = ['stable', 'testing'];
const RENAMED_BRANCHES: Record<string, string> = { dom: 'testing', starpilot: 'stable' };
const MAX_OWNER_TYPO_DISTANCE = 3;
const MAX_BRANCH_TYPO_DISTANCE = 2;
const INSTALL_STRING = /([a-z0-9_.-]{4,})\s*\/\s*([a-z0-9_.-]+)/gi;

export function installStringIssues(content: string): string[] {
  const issues: string[] = [];
  for (const [typed, owner, branch] of content.matchAll(INSTALL_STRING)) {
    const ownerLower = owner.toLowerCase();
    if (ownerLower !== OWNER && editDistance(ownerLower, OWNER) > MAX_OWNER_TYPO_DISTANCE) continue;
    const problems: string[] = [];
    if (ownerLower !== OWNER) problems.push(`"${owner}" is misspelled, it should be "${OWNER}"`);
    const branchLower = branch.toLowerCase();
    const closest = BRANCHES.find((b) => editDistance(branchLower, b) <= MAX_BRANCH_TYPO_DISTANCE);
    if (RENAMED_BRANCHES[branchLower]) {
      problems.push(`"${branch}" is not an install branch (old name or the repo name), install with "${RENAMED_BRANCHES[branchLower]}"`);
    } else if (!BRANCHES.includes(branchLower) && closest) {
      problems.push(`"${branch}" is misspelled, it should be "${closest}"`);
    } else if (BRANCHES.includes(branchLower) && branch !== branchLower) {
      problems.push(`"${branch}" should be all lowercase: "${branchLower}"`);
    }
    if (problems.length > 0) issues.push(`typed "${typed}": ${problems.join('; ')}`);
  }
  return issues;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}
