import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { BacklogError, git, repoRoot } from 'open-backlog';

/**
 * Sync (2.4.6, D3): the board commits every change, but shares nothing until you click Sync,
 * which runs `git pull --rebase`, then `git push`, with your own git: your identity, SSH key or
 * credential helper, hooks and settings. The board never asks for a password or a token; if git
 * would have to ask, Sync stops and says so. A conflict is left exactly as git leaves it, for you
 * to finish or undo by hand, and the board makes no changes until it's resolved.
 */

export interface Commit { hash: string; subject: string }

export interface Conflict {
  /** A rebase stopped by Sync (or one of your own), or a merge. */
  kind: 'rebase' | 'merge';
  /** The files with conflict markers, from the repository's top folder. */
  files: string[];
  /** What to do next, in order, as commands you can type. */
  steps: string[];
}

export interface SyncStatus {
  /** False outside git: there is nothing to sync. */
  git: boolean;
  /** null on a detached HEAD. */
  branch: string | null;
  /** The branch it pulls from and pushes to (origin/main), or null if none is set up. */
  upstream: string | null;
  /** Your commits not yet shared, newest first. */
  unshared: Commit[];
  /** Teammates' commits already fetched but not yet in yours (as of the last pull or fetch). */
  behind: number;
  /** Tracked files with uncommitted changes (git status lines): a pull would refuse them. */
  uncommitted: string[];
  conflict: Conflict | null;
}

export interface SyncResult {
  /** Commits received from teammates, and commits of yours sent. */
  received: number;
  sent: number;
  status: SyncStatus;
}

/** Sync couldn't finish; `conflict` says what's left to resolve, if that was why. */
export class SyncError extends Error {
  constructor(readonly status: number, message: string, readonly conflict: Conflict | null = null) {
    super(message);
  }
}

const lines = (s: string) => s.split('\n').map(l => l.trimEnd()).filter(Boolean);
const tryGit = (root: string, args: string[]): string | null => {
  try {
    return git(root, args).trim();
  } catch {
    return null;
  }
};

/** Where things stand, without touching the network. */
export function syncStatus(dir: string): SyncStatus {
  const root = repoRoot(dir);
  if (!root) return { git: false, branch: null, upstream: null, unshared: [], behind: 0, uncommitted: [], conflict: null };
  const branch = tryGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']) || null;
  const upstream = branch ? tryGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']) || null : null;
  const unshared = upstream
    ? lines(git(root, ['log', '--format=%h %s', '@{u}..HEAD'])).map(l => ({ hash: l.slice(0, l.indexOf(' ')), subject: l.slice(l.indexOf(' ') + 1) }))
    : [];
  const behind = upstream ? Number(git(root, ['rev-list', '--count', 'HEAD..@{u}']).trim()) : 0;
  const uncommitted = lines(git(root, ['status', '--porcelain', '--untracked-files=no']));
  return { git: true, branch, upstream, unshared, behind, uncommitted, conflict: conflictOf(root) };
}

/** A rebase or merge left in progress, with its conflicted files and the steps to finish it. */
export function conflictOf(dir: string): Conflict | null {
  const root = repoRoot(dir);
  if (!root) return null;
  const gitPath = (name: string) => {
    const p = git(root, ['rev-parse', '--git-path', name]).trim();
    return isAbsolute(p) ? p : join(root, p);
  };
  const kind = existsSync(gitPath('rebase-merge')) || existsSync(gitPath('rebase-apply')) ? 'rebase'
    : existsSync(gitPath('MERGE_HEAD')) ? 'merge' : null;
  if (!kind) return null;
  const files = lines(git(root, ['diff', '--name-only', '--diff-filter=U']));
  const fix = files.length
    ? [`Open ${files.length === 1 ? 'the file' : 'each file'} and keep what's right between the <<<<<<< and >>>>>>> lines, removing the markers`, `git add ${files.join(' ')}`]
    : [];
  const steps = kind === 'rebase'
    ? [...fix, 'git rebase --continue (repeat the steps above if git stops again)', 'Or, to put everything back as it was before Sync: git rebase --abort', 'Then click Sync again to send your changes']
    : [...fix, 'git commit', 'Or, to put everything back as it was: git merge --abort', 'Then click Sync again'];
  return { kind, files, steps };
}

/** Runs `fn` with git unable to prompt: no password or passphrase questions, and no endless wait. */
function noPrompts<T>(root: string, fn: () => T): T {
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: '0', GIT_HTTP_LOW_SPEED_LIMIT: '1000', GIT_HTTP_LOW_SPEED_TIME: '30' };
  // Your own ssh command, if you set one, is kept as it is.
  if (!process.env['GIT_SSH_COMMAND'] && !process.env['GIT_SSH'] && !tryGit(root, ['config', 'core.sshCommand'])) {
    env['GIT_SSH_COMMAND'] = 'ssh -o BatchMode=yes -o ConnectTimeout=20';
  }
  const saved = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) Reflect.deleteProperty(process.env, k); else process.env[k] = v;
  }
}

const LOGIN = /authentication failed|permission denied|could not read (username|password)|terminal prompts disabled|host key verification|publickey|\b40[13]\b/i;

/** git's complaint, and what to do about it. */
function explain(e: unknown, step: 'pull' | 'push', upstream: string): SyncError {
  const said = e instanceof BacklogError ? e.message : String(e);
  if (LOGIN.test(said)) {
    return new SyncError(502, `${said}. git couldn't log in to ${upstream.split('/')[0]}: check that git ${step} works in a terminal here. The board uses your own git login and never asks for a password or token.`);
  }
  if (step === 'push' && /rejected|fetch first|non-fast-forward/i.test(said)) {
    return new SyncError(409, `${said}. Someone shared changes while you were syncing: click Sync again.`);
  }
  return new SyncError(502, `${said}. Nothing was ${step === 'pull' ? 'changed' : 'sent'}; try again, or run git ${step} in a terminal to see more.`);
}

/** Sync: pull (rebase), then push. Throws SyncError for anything you need to act on. */
export function sync(dir: string): SyncResult {
  const root = repoRoot(dir);
  if (!root) throw new SyncError(400, 'this backlog is not in a git repository, so there is nothing to sync');
  const before = syncStatus(root);
  if (before.conflict) throw new SyncError(409, `A ${before.conflict.kind} is still in progress; finish it or undo it first.`, before.conflict);
  if (!before.branch) throw new SyncError(409, 'HEAD is not on a branch (detached); check out a branch to sync');
  if (!before.upstream) {
    throw new SyncError(409, `${before.branch} has no remote branch to sync with yet. Share it once from a terminal: git push -u origin ${before.branch}`);
  }
  if (before.uncommitted.length) {
    const files = before.uncommitted.map(l => l.slice(3));
    throw new SyncError(409, `${files.length === 1 ? 'A file has' : `${files.length} files have`} changes that aren't committed (${files.join(', ')}); commit or stash them, then Sync`);
  }
  const upstream = before.upstream;

  return noPrompts(root, () => {
    const was = git(root, ['rev-parse', '@{u}']).trim();
    try {
      git(root, ['pull', '--rebase']);
    } catch (e) {
      const conflict = conflictOf(root);
      if (conflict) {
        throw new SyncError(409, `Your changes and a teammate's change the same lines in ${conflict.files.join(', ') || 'some files'}. Nothing was sent. git has stopped partway so you can choose what to keep.`, conflict);
      }
      throw explain(e, 'pull', upstream);
    }
    const now = git(root, ['rev-parse', '@{u}']).trim();
    const received = was === now ? 0 : Number(git(root, ['rev-list', '--count', `${was}..${now}`]).trim());
    const ahead = Number(git(root, ['rev-list', '--count', '@{u}..HEAD']).trim());
    if (ahead > 0) {
      try {
        git(root, ['push']);
      } catch (e) {
        throw explain(e, 'push', upstream);
      }
    }
    return { received, sent: ahead, status: syncStatus(root) };
  });
}
