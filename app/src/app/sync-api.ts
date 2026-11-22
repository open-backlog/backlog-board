/** The board's Sync (2.4.6): what isn't shared yet, and Sync itself (server/sync.ts). */
export interface Commit { hash: string; subject: string }
export interface Conflict { kind: 'rebase' | 'merge'; files: string[]; steps: string[] }
export interface SyncStatus {
  git: boolean;
  branch: string | null;
  upstream: string | null;
  unshared: Commit[];
  behind: number;
  uncommitted: string[];
  conflict: Conflict | null;
}
export interface SyncResult { received: number; sent: number; status: SyncStatus }

/** Sync stopped: git's reason, and the conflict to resolve if that was why. */
export class SyncFailure extends Error {
  constructor(message: string, readonly conflict: Conflict | null) {
    super(message);
  }
}

export async function loadSync(): Promise<SyncStatus> {
  const res = await fetch('api/v1/sync');
  const body = (await res.json().catch(() => ({}))) as SyncStatus & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `the board's server answered ${res.status}`);
  return body;
}

export async function runSync(): Promise<SyncResult> {
  const res = await fetch('api/v1/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const body = (await res.json().catch(() => ({}))) as SyncResult & { error?: string; conflict?: Conflict | null };
  if (!res.ok) throw new SyncFailure(body.error ?? `the board's server answered ${res.status}`, body.conflict ?? null);
  return body;
}

const changes = (n: number) => `${n} change${n === 1 ? '' : 's'}`;

/** "Got 1 change, sent 2 changes." or "Already up to date." */
export function done(r: SyncResult): string {
  if (!r.received && !r.sent) return 'Already up to date.';
  return [r.received ? `Got ${changes(r.received)}` : '', r.sent ? `${r.received ? 'sent' : 'Sent'} ${changes(r.sent)}` : ''].filter(Boolean).join(', ') + '.';
}

/** The button's count: "3 to share", "All shared", or "Sync paused" while a conflict is open (git is between commits then). */
export const toShare = (s: SyncStatus) => (s.conflict ? 'Sync paused' : s.unshared.length ? `${s.unshared.length} to share` : 'All shared');
