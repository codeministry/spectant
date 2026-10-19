// activity-log — the one write path of `.spectant/activity.jsonl` (spec 032, T3, ISC-33), shared by the CLI
// (`spec-check claim|release|activity|run`) and the hook command.
//
// The root is resolved from a directory the caller passes, never from the process's current directory: the CLI passes
// its working directory, the hook passes `CLAUDE_PROJECT_DIR`, which may be a linked worktree. Either way the root is
// the folder that holds the common git directory (`git rev-parse --git-common-dir`), so a builder's worktree writes into
// the main checkout's log, as the app reads it. Every line is core's plan (`core/src/activity-text.ts`); this module
// only places it. The strict run-event writer requires `claim` on a dispatch, build, patch or apply line it writes;
// core's planner and reader stay tolerant of old lines without one (ISC-213).
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { runEventLine } from '../../core/src/activity-text.ts';
import type { RunEventLineInput } from '../../core/src/activity-text.ts';

export type ActivityLogErrorCode = 'claim-required';

/** A line the writer refuses before core plans it; nothing was written. */
export class ActivityLogError extends Error {
  readonly code: ActivityLogErrorCode;

  constructor(code: ActivityLogErrorCode, message: string) {
    super(message);
    this.name = 'ActivityLogError';
    this.code = code;
  }
}

/** The main checkout's root: the parent of the common git directory; `dir` itself outside git. */
export function repoRoot(dir: string): string {
  const r = Bun.spawnSync(['git', 'rev-parse', '--git-common-dir'], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  const common = r.exitCode === 0 ? r.stdout.toString().trim() : '';
  return common === '' ? dir : dirname(resolve(dir, common));
}

/** The activity log of a repository root. */
export const activityPath = (root: string): string => join(root, '.spectant', 'activity.jsonl');

function readIfExists(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Appends one line core planned to `.spectant/activity.jsonl` at the root (the folder created when absent), a newline
 * first when the file does not end in one. Pass a root from `repoRoot`, so a builder's worktree writes there too.
 */
export function appendActivity(root: string, line: string): void {
  const path = activityPath(root);
  mkdirSync(dirname(path), { recursive: true });
  const existing = readIfExists(path);
  const lead = existing !== null && existing !== '' && !existing.endsWith('\n') ? '\n' : '';
  appendFileSync(path, `${lead}${line}`);
}

/**
 * Appends one dispatch, build, patch or apply line and returns it. A line without `claim` is refused with
 * `claim-required` and core refuses a malformed one; either way nothing is written.
 */
export function appendRunEvent(root: string, input: RunEventLineInput): string {
  if (input.claim === undefined || input.claim === '') {
    throw new ActivityLogError('claim-required', `a ${input.event} line of ${input.task} needs its claim; nothing written`);
  }
  const line = runEventLine(input);
  appendActivity(root, line);
  return line;
}
