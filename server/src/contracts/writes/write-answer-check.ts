/**
 * The answer validators of the writes contract (part of `contracts/writes.contract.ts`): `writeAnswerOf`, the
 * client's side, which types a write's answer by its status when the body fits it.
 */
import { parseActor } from '../../../../core/src/actor.ts';
import { validateEventLine } from '../../../../core/src/events.ts';
import { FILE_KINDS } from '../../../../core/src/files.ts';
import type { ClaimLock, LockSource } from '../../../../core/src/files.ts';
import { RELEASE_REFUSALS, REVIEWED_HASH_FILES, isGateReviewedRequest, isTransitionRequest } from '../spec-routes.contract.ts';
import type { ReviewedHashes } from '../spec-routes.contract.ts';
import type { WriteAnswer } from './write-answers.ts';
import { REVIEWED_EVENT } from './write-events.ts';
import { ACTIVITY_PATH, BACKLOG_PATH, SPEC_PATH, TASKS_PATH, writePathsOf } from './writes-table.ts';
import type { WriteOperation } from './writes-table.ts';

// ─── Answer validators (the client's side) ───────────────────────────────────────────────────────────────────────

const HEX64 = /^[0-9a-f]{64}$/;
/**
 * The fields the validators read, named: a record with literal keys, not an index signature, so the web tsconfig's
 * `noPropertyAccessFromIndexSignature` admits the dot access this file uses (T111).
 */
type RecKey =
  | 'activity' | 'actor' | 'at' | 'backlog' | 'checked' | 'claim' | 'command' | 'error' | 'event' | 'expected' | 'feature' | 'files'
  | 'folder' | 'from' | 'hash' | 'hashes' | 'id' | 'idea' | 'kind' | 'line' | 'lock' | 'lockSource' | 'number' | 'outcome' | 'reason'
  | 'removed' | 'run' | 'session' | 'since' | 'source' | 'spec' | 'task' | 'tasks' | 'text' | 'to' | 'ts';
type Rec = Partial<Record<RecKey, unknown>>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isHex = (v: unknown): boolean => typeof v === 'string' && HEX64.test(v);
const isLockSource = (v: unknown): v is LockSource => v === 'frontier' || v === 'activity' || v === 'none';
const isHashes = (v: unknown): v is ReviewedHashes => isGateReviewedRequest({ hashes: v });
const isFileList = (v: unknown): boolean =>
  Array.isArray(v) && v.length > 0 && v.every((f) => (Object.values(REVIEWED_HASH_FILES) as unknown[]).includes(f));

function isReviewedEvent(v: unknown): boolean {
  if (!isRec(v)) return false;
  const check = validateEventLine(JSON.stringify(v));
  // The viewer's `u:` id or the fallback agent id: an actor of the grammar, never a legacy value (T80).
  return check.ok && v.from === REVIEWED_EVENT.from && v.to === REVIEWED_EVENT.to && check.event.actorRef?.legacy === false;
}

function isClaimLock(v: unknown): v is ClaimLock {
  return (
    isRec(v) &&
    (v.source === 'frontier' || v.source === 'activity') &&
    typeof v.claim === 'string' &&
    typeof v.session === 'string' &&
    typeof v.since === 'string'
  );
}

/** A stage name a transition may carry: the request's own validator, over a well-formed placeholder hash. */
const isStage = (v: unknown): boolean => isTransitionRequest({ to: v, hash: '0'.repeat(64) });

/** The transition's event: a valid line from `from` to `to`, its actor of the grammar (the viewer or the fallback). */
function isTransitionEvent(v: unknown, from: unknown, to: unknown): boolean {
  if (!isRec(v)) return false;
  const check = validateEventLine(JSON.stringify(v));
  return check.ok && v.from === from && v.to === to && check.event.actorRef?.legacy === false;
}

/** `specs/ideas/<slug>.md`: a story file's repository path, as the allocation's 200 and 409 name it. */
const IDEAS_DIR = FILE_KINDS.idea.repoPath ?? '';
const isStoryPath = (v: unknown): boolean =>
  typeof v === 'string' &&
  v.startsWith(IDEAS_DIR) &&
  v.endsWith('.md') &&
  v.length > IDEAS_DIR.length + '.md'.length &&
  !v.slice(IDEAS_DIR.length).includes('/');
const SPEC_FOLDER = /^specs\/(\d{3})-[^/]+\/$/;

/** The allocation's 200: `NNN`, its folder `specs/NNN-slug/`, the files `WRITE_PATHS.allocate` writes there, the story removed. */
function isAllocated(b: Rec): boolean {
  if (typeof b.id !== 'string' || typeof b.folder !== 'string' || !isStoryPath(b.removed)) return false;
  const folder = SPEC_FOLDER.exec(b.folder);
  if (folder?.[1] !== b.id) return false;
  const expected = writePathsOf('allocate', b.folder.slice('specs/'.length, -1)).writes;
  const files = b.files;
  return Array.isArray(files) && files.length === expected.length && expected.every((path, i) => files[i] === path);
}

const PRIORITIES: readonly unknown[] = ['P1', 'P2', 'P3', 'P4'];

/** The backlog write's event (core's `BacklogEvent`): its six keys in order, an actor of the grammar, ranks or priorities. */
function isBacklogEvent(v: unknown): boolean {
  if (!isRec(v)) return false;
  const keys = ['ts', 'actor', 'kind', 'feature', 'from', 'to'];
  if (Object.keys(v).join() !== keys.join()) return false;
  if (typeof v.ts !== 'string' || Number.isNaN(Date.parse(v.ts)) || typeof v.feature !== 'string') return false;
  if (typeof v.actor !== 'string' || parseActor(v.actor).legacy) return false;
  const rank = (n: unknown): boolean => Number.isInteger(n) && (n as number) >= 1;
  if (v.kind === 'move') return rank(v.from) && rank(v.to);
  return v.kind === 'priority' && PRIORITIES.includes(v.from) && PRIORITIES.includes(v.to);
}

/** The release's line: `runReleaseEvent`'s keys in order, a person's `u:` session, exactly one of `spec` and `idea`. */
function isReleaseEvent(v: unknown): boolean {
  if (!isRec(v)) return false;
  const item = typeof v.spec === 'string' ? 'spec' : 'idea';
  if (Object.keys(v).join() !== ['ts', 'event', 'run', 'command', 'session', item, 'outcome'].join()) return false;
  const filled = (s: unknown): boolean => typeof s === 'string' && s !== '';
  const person = typeof v.session === 'string' && parseActor(v.session).kind === 'person';
  return filled(v.ts) && !Number.isNaN(Date.parse(v.ts as string)) && v.event === 'run-end' && filled(v.run) && filled(v.command) && person && filled(v[item]) && v.outcome === 'released';
}

function isOk(route: WriteOperation, b: Rec): boolean {
  if (route === 'runRelease') return isHex(b.hash) && isReleaseEvent(b.event);
  if (route === 'backlog') return isHex(b.hash) && isBacklogEvent(b.event);
  if (!isLockSource(b.lockSource)) return false;
  if (route === 'gateReviewed') return typeof b.at === 'string' && isHashes(b.hashes) && isReviewedEvent(b.event);
  if (route === 'transition') return isStage(b.from) && isStage(b.to) && isHex(b.hash) && isTransitionEvent(b.event, b.from, b.to);
  if (route === 'allocate') return isAllocated(b);
  const line = b.line;
  return (
    typeof b.task === 'string' &&
    typeof b.checked === 'boolean' &&
    isHex(b.hash) &&
    isRec(line) &&
    Number.isInteger(line.number) &&
    (line.number as number) >= 1 &&
    typeof line.text === 'string' &&
    !line.text.includes('\n')
  );
}

function isStale(route: WriteOperation, b: Rec): boolean {
  if (b.error !== 'hash-mismatch' || !isRec(b.expected) || !Array.isArray(b.files)) return false;
  const files = b.files as unknown[];
  if (route === 'allocate') return files.length === 1 && isStoryPath(files[0]) && isHex(b.expected.idea);
  if (route === 'backlog') return files.length === 1 && files[0] === BACKLOG_PATH && isHex(b.expected.backlog);
  if (route === 'runRelease') return files.length === 1 && files[0] === ACTIVITY_PATH && isHex(b.expected.activity);
  if (!isFileList(files)) return false;
  if (route === 'gateReviewed') return isHashes(b.expected);
  if (route === 'transition') return files.length === 1 && files[0] === SPEC_PATH && isHex(b.expected.spec);
  return files.length === 1 && files[0] === TASKS_PATH && isHex(b.expected.tasks);
}

/**
 * The three 422s: the backlog write's (core's reason phrase), the transition's (the stage row's phrase and the command that would make the move, or null) and the
 * allocation's (`folder-exists` or `not-in-index`, with the folder it would create, or null).
 */
function isRefused(route: WriteOperation, b: Rec): boolean {
  if (route === 'runRelease') return b.error === 'release-refused' && (RELEASE_REFUSALS as readonly unknown[]).includes(b.reason);
  if (route === 'backlog') return b.error === 'backlog-refused' && typeof b.reason === 'string';
  if (route === 'transition') {
    return b.error === 'transition-refused' && typeof b.reason === 'string' && (b.command === null || typeof b.command === 'string');
  }
  return (
    route === 'allocate' &&
    b.error === 'allocate-refused' &&
    (b.reason === 'folder-exists' || b.reason === 'not-in-index') &&
    (b.folder === null || (typeof b.folder === 'string' && SPEC_FOLDER.test(b.folder)))
  );
}

/**
 * The answer typed by its status when the body fits it; null for any other status or a body that does not fit. It
 * covers the five app writes (`WriteOperation`): the three spec routes and, since T111, the allocation, and since spec
 * 036 the backlog write, so the web client validates every write answer here and nowhere else. The backlog write has no
 * 423, so a 423 body never fits it.
 */
export function writeAnswerOf<R extends WriteOperation>(route: R, status: number, body: unknown): WriteAnswer<R> | null {
  if (!isRec(body)) return null;
  // The run release reads no lock: no 423 body fits it (spec 040, ISC-226).
  if (route === 'runRelease' && status === 423) return null;
  const fits =
    (status === 200 && isOk(route, body)) ||
    (status === 400 && body.error === 'invalid-body') ||
    (status === 409 && isStale(route, body)) ||
    (status === 422 && isRefused(route, body)) ||
    (status === 423 && route !== 'backlog' && body.error === 'locked' && isClaimLock(body.lock));
  return fits ? ({ status, body } as unknown as WriteAnswer<R>) : null;
}
