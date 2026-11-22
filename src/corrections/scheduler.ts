export const BASE_WAIT_MS = 60_000;
export const BUMP_FLOOR_MS = 30_000;
export const HARD_CAP_MS = 180_000;
export const COOLDOWN_MS = 5 * 60_000;
export const AUTHOR_COOLDOWN_MS = 2 * 60 * 60_000;

export type RemovalReason = 'trusted-answer' | 'mentioned-rebecca';

export interface CheckEntry {
  authorId: string;
  joinedAt: number;
  messageIds: string[];
}

export interface RemovedEntry {
  authorId: string;
  reason: RemovalReason;
}

export interface FiredCheck {
  channelId: string;
  entries: CheckEntry[];
  removed: RemovedEntry[];
}

export interface DroppedCheck {
  channelId: string;
  removed: RemovedEntry[];
}

export interface SchedulerHooks {
  onFire(check: FiredCheck): void;
  onDrop(check: DroppedCheck): void;
}

interface ActiveCheck {
  firstAt: number;
  deadline: number;
  entries: Map<string, CheckEntry>;
  removed: RemovedEntry[];
  timer?: ReturnType<typeof setTimeout>;
}

export class CorrectionScheduler {
  private checks = new Map<string, ActiveCheck>();
  private cooldownUntil = new Map<string, number>();
  private authorCooldownUntil = new Map<string, number>();

  constructor(
    private hooks: SchedulerHooks,
    private now: () => number = Date.now,
  ) {}

  trigger(channelId: string, authorId: string, messageId: string): void {
    const now = this.now();
    if (now < (this.cooldownUntil.get(channelId) ?? 0) || now < (this.authorCooldownUntil.get(authorId) ?? 0)) {
      this.bump(channelId);
      return;
    }
    const check = this.checks.get(channelId);
    if (!check) {
      this.open(channelId, [{ authorId, joinedAt: now, messageIds: [messageId] }]);
      return;
    }
    const entry = check.entries.get(authorId);
    if (entry) entry.messageIds.push(messageId);
    else check.entries.set(authorId, { authorId, joinedAt: now, messageIds: [messageId] });
    this.bump(channelId);
  }

  bump(channelId: string): void {
    const check = this.checks.get(channelId);
    if (!check) return;
    const cap = check.firstAt + HARD_CAP_MS;
    const deadline = Math.min(cap, Math.max(check.deadline, this.now() + BUMP_FLOOR_MS));
    if (deadline !== check.deadline) this.schedule(channelId, check, deadline);
  }

  remove(channelId: string, authorId: string, reason: RemovalReason): void {
    const check = this.checks.get(channelId);
    if (!check?.entries.delete(authorId)) return;
    check.removed.push({ authorId, reason });
    if (check.entries.size > 0) return;
    clearTimeout(check.timer);
    this.checks.delete(channelId);
    this.hooks.onDrop({ channelId, removed: check.removed });
  }

  pendingAuthors(channelId: string): CheckEntry[] {
    return [...(this.checks.get(channelId)?.entries.values() ?? [])];
  }

  startCooldown(channelId: string): void {
    this.cooldownUntil.set(channelId, this.now() + COOLDOWN_MS);
  }

  startAuthorCooldown(authorId: string): void {
    this.authorCooldownUntil.set(authorId, this.now() + AUTHOR_COOLDOWN_MS);
  }

  clearCooldown(channelId: string): void {
    this.cooldownUntil.delete(channelId);
  }

  private open(channelId: string, entries: CheckEntry[]): void {
    const firstAt = Math.min(...entries.map((e) => e.joinedAt));
    const check: ActiveCheck = {
      firstAt,
      deadline: 0,
      entries: new Map(entries.map((e) => [e.authorId, e])),
      removed: [],
    };
    this.checks.set(channelId, check);
    this.schedule(channelId, check, firstAt + BASE_WAIT_MS);
  }

  private schedule(channelId: string, check: ActiveCheck, deadline: number): void {
    clearTimeout(check.timer);
    check.deadline = deadline;
    check.timer = setTimeout(() => this.fire(channelId, check), Math.max(0, deadline - this.now()));
  }

  private fire(channelId: string, check: ActiveCheck): void {
    if (this.checks.get(channelId) !== check) return;
    this.checks.delete(channelId);
    const firedAt = this.now();
    const ready: CheckEntry[] = [];
    const carried: CheckEntry[] = [];
    for (const entry of check.entries.values()) {
      (firedAt - entry.joinedAt < BUMP_FLOOR_MS ? carried : ready).push(entry);
    }
    if (ready.length > 0) this.hooks.onFire({ channelId, entries: ready, removed: check.removed });
    if (carried.length > 0) this.open(channelId, carried);
  }
}
