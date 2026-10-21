/**
 * The write table of the writes contract (part of `contracts/writes.contract.ts`): the reviewed mark's file types, the
 * write routes and their hash headers, the files the writes touch, `WRITE_TABLE`, `WRITE_PATHS` and the request bodies.
 *
 * | route | body (client's sha256) | 200 | 409 `hash-mismatch` | 423 `locked` |
 * |-------|------------------------|-----|---------------------|--------------|
 * | `POST …/:id/gate/reviewed` | `{hashes: {spec, plan, tasks}}`, the `X-Spectant-Reviewed-Hashes` of the rendered page (normalised gate hashes, null = absent file) | `GateReviewedWritten`: `at`, the hashes written, `lockSource`, the `event` appended | `StaleGate`: `files` that changed, `expected` = their hashes now | `{lock: ClaimLock}` |
 * | `POST …/:id/tasks/:tid/check` | `{checked, hash}`, `hash` = the `X-Spectant-Tasks-Hash` (raw sha256 of tasks.md) | `TaskCheckWritten`: task, state, tasks.md's new raw `hash`, `lockSource`, the changed `line` | `StaleTasks`: `files: ['tasks.md']`, `expected.tasks` = raw hash now | `{lock: ClaimLock}` |
 *
 * Spec 008 (T81) adds two writes, declared here and served by later tasks (`WRITE_TABLE`, `WRITE_PATHS`):
 *
 * | write | trigger | client's hash | 200 | 409 `hash-mismatch` | 422 | 423 `locked` | 423 `run-locked` |
 * |-------|---------|---------------|-----|---------------------|-----|--------------|------------------|
 * | reviewed mark | `POST …/:id/gate/reviewed` | normalised gate hashes | `GateReviewedWritten` | `StaleGate` | — | `Locked` | `RunLocked` |
 * | task checkbox | `POST …/:id/tasks/:tid/check` | raw tasks.md | `TaskCheckWritten` | `StaleTasks` | — | `Locked` | `RunLocked` |
 * | transition | `POST …/:id/transition` (T83) | raw spec.md, `X-Spectant-Spec-Hash` | `TransitionWritten` | `StaleSpec` | `TransitionRefused` | `Locked` | `RunLocked` |
 * | allocate | `POST …/ideas/:slug/allocate` (T87) | raw story file, `IdeaPage.hash` | `IdeaAllocated` | `StaleIdea` | `AllocateRefused` | `Locked` | `RunLocked` |
 * | backlog | `POST …/:ws/backlog` (spec 036) | raw `specs/backlog.md`, `PlanningModel.backlogHash` | `BacklogWritten` | `StaleBacklog` | `BacklogRefused` | — | — |
 * | run release | `POST …/:ws/runs/:run/release` (spec 040) | raw `.spectant/activity.jsonl`, `X-Spectant-Activity-Hash` | `RunReleased` | `StaleActivity` | `RunReleaseRefused` | — | — |
 *
 * These six are every write the app makes on a user's action. The backlog write, the seventh write path, reads no lock
 * source and never answers 423 (`WRITE_TABLE.backlog.locked` is null): `specs/backlog.md` belongs to no spec, and no
 * agent writes it. The feature-level code-review mark
 * (`.gates/code-reviewed.json` in each folder of a main feature, plus one event line each) is the fifth write path,
 * `WRITE_PATHS.codeReviewFeature`, but it has no route: the skill triggers it through the CLI (`spectant gate
 * code-reviewed F<n>`, T93, `feature-gate.ts`), never the UI, so it is not in this table. The token measurement
 * (`specs/tokens.jsonl`, once per repository) is the sixth, `WRITE_PATHS.tokens`, written in place only by the CLI
 * `spectant tokens --yes` (spec 009, `tokens-cli.ts`) and likewise without a route or a row here.
 *
 * Where a write lands (spec 027, T22, ISC-181; `WRITE_TABLE[op].root`): the three writes on an existing spec (reviewed
 * mark, task checkbox, transition) resolve their `WRITE_PATHS` against the spec's read source, the main checkout or,
 * when `specs/NNN-slug/` is tracked and the spec has a worktree of its own, that worktree's copy, the same copy the
 * client's hash was rendered from; the main checkout then stays byte-identical. The allocation, the CLI's feature mark
 * and the token measurement resolve theirs against the main checkout. The paths themselves do not change.
 *
 * `core/src/gates.ts` is not imported, not even as types: it hashes with `node:crypto`, and a type import still
 * type-checks its module under the web tsconfig, which rejects it. `ReviewedFile` and `ReviewedMark` are therefore
 * declared here, pinned equal to gates.ts' own by `tests/writes.contract.test.ts`, so the web client imports
 * `writeAnswerOf` directly (spec 008, T111).
 */
import { FILE_KINDS } from '../../../../core/src/files.ts';
import {
  ACTIVITY_HASH_HEADER,
  REVIEWED_HASHES_HEADER,
  SPEC_HASH_HEADER,
  TASKS_HASH_HEADER,
  isGateReviewedRequest,
  isTaskCheckRequest,
  isTransitionRequest,
  parseReviewedHashes,
  specRoutes,
} from '../spec-routes.contract.ts';
import type {
  ApiError,
  GateReviewedRequest,
  InvalidBody,
  SpecRouteName,
  TaskCheckRequest,
  TransitionRequest,
} from '../spec-routes.contract.ts';

/** `ReviewedFile` of `core/src/gates.ts`: the files the reviewed mark hashes (equality pinned by the contract test). */
export type ReviewedFile = 'spec.md' | 'plan.md' | 'tasks.md';

/** `ReviewedMark` of `core/src/gates.ts`: the bytes of `.gates/reviewed.json` (equality pinned by the contract test). */
export interface ReviewedMark {
  readonly gate: 'reviewed';
  readonly at: string;
  readonly files: Readonly<Record<ReviewedFile, string | null>>;
}

// ─── Routes ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The POST routes of `SPEC_ROUTE_TABLE`, in table order: the two writes of spec 002 and the transition (T83). */
export const WRITE_ROUTES = ['gateReviewed', 'taskCheck', 'transition'] as const satisfies readonly SpecRouteName[];
export type WriteRoute = (typeof WRITE_ROUTES)[number];

/** The builders of the write routes; the same functions as `specRoutes`. */
export const writeRoutes = {
  gateReviewed: specRoutes.gateReviewed,
  taskCheck: specRoutes.taskCheck,
  transition: specRoutes.transition,
} as const satisfies Record<WriteRoute, (...args: never[]) => string>;

/** The statuses `WriteAnswer` types; 403, 404 and 405 are the route layer's, as on every spec route. */
export const WRITE_STATUSES = [200, 400, 409, 423] as const;

/** The error codes only a write sends, all in `API_ERRORS`. */
export const WRITE_ERRORS = ['invalid-body', 'hash-mismatch', 'locked', 'run-locked'] as const satisfies readonly ApiError[];

/** The GET header each write's hash comes from, on the answer the client rendered. */
export const WRITE_HASH_HEADER = {
  gateReviewed: REVIEWED_HASHES_HEADER,
  taskCheck: TASKS_HASH_HEADER,
  transition: SPEC_HASH_HEADER,
} as const satisfies Record<WriteRoute, string>;

/** The files the writes touch, relative to the spec folder. */
export const REVIEWED_MARK_PATH = FILE_KINDS.gateReviewed.path;
export const EVENTS_PATH = FILE_KINDS.events.path;
export const TASKS_PATH = FILE_KINDS.tasks.path;
export const SPEC_PATH = FILE_KINDS.spec.path;
export const CONTEXT_PATH = FILE_KINDS.context.path;
/** The backlog and its event log, relative to the repository root (spec 036). */
export const BACKLOG_PATH = FILE_KINDS.backlog.repoPath ?? '';
export const BACKLOG_EVENTS_PATH = FILE_KINDS.backlogEvents.repoPath ?? '';
/** The activity log, relative to the main checkout (spec 040, ISC-226): the one file the run release appends to. */
export const ACTIVITY_PATH = '.spectant/activity.jsonl';

// ─── The four app writes (spec 008, T81) ─────────────────────────────────────────────────────────────────────────

/** Every write the app makes on a user's action, in table order; the first three are `WRITE_ROUTES`. */
export const WRITE_OPERATIONS = ['gateReviewed', 'taskCheck', 'transition', 'allocate', 'backlog', 'runRelease'] as const;
export type WriteOperation = (typeof WRITE_OPERATIONS)[number];

export interface WriteTableEntry {
  /** The client's hash: the GET header it was rendered with, or the body field it read. */
  readonly hashFrom: string;
  /** `normalised` by `hashForGate` (the reviewed mark), or `raw` file bytes. */
  readonly hash: 'normalised' | 'raw';
  /** The 409 body, by type name: `hash-mismatch` with `files` and `expected`, nothing written. */
  readonly conflict: 'StaleGate' | 'StaleTasks' | 'StaleSpec' | 'StaleIdea' | 'StaleBacklog' | 'StaleActivity';
  /** The 422 body, by type name; null for a write the workflow never refuses. */
  readonly refused: 'TransitionRefused' | 'AllocateRefused' | 'BacklogRefused' | 'RunReleaseRefused' | null;
  /**
   * The 423 body, by type name: the same `{error: 'locked', lock}` for every write that reads the lock sources; null for
   * the backlog write, which reads none (spec 036).
   */
  readonly locked: 'Locked' | null;
  /**
   * The 423 body while a run on the write's item is `running` (spec 040, ISC-225): `RunLocked` for every write on a spec
   * or a story; null for the backlog write, which belongs to no item a run works on.
   */
  readonly runLocked: 'RunLocked' | null;
  /**
   * True while its route is registered and served (`SPEC_ROUTE_TABLE`, or `WORKSPACE_ROUTE_TABLE` for `allocate`);
   * false while its route has no handler (every one has since T87).
   */
  readonly registered: boolean;
  /**
   * What the write's `WRITE_PATHS` are relative to (spec 027, T22): `source`, the spec's read source (the main
   * checkout, or the worktree copy when the spec is read from it), or `main`, always the main checkout.
   */
  readonly root: 'source' | 'main';
}

/** The five writes with their hash, 409, 422 and 423 forms and the root their paths resolve against (the header's table). */
export const WRITE_TABLE = {
  gateReviewed: { hashFrom: REVIEWED_HASHES_HEADER, hash: 'normalised', conflict: 'StaleGate', refused: null, locked: 'Locked', runLocked: 'RunLocked', registered: true, root: 'source' },
  taskCheck: { hashFrom: TASKS_HASH_HEADER, hash: 'raw', conflict: 'StaleTasks', refused: null, locked: 'Locked', runLocked: 'RunLocked', registered: true, root: 'source' },
  transition: { hashFrom: SPEC_HASH_HEADER, hash: 'raw', conflict: 'StaleSpec', refused: 'TransitionRefused', locked: 'Locked', runLocked: 'RunLocked', registered: true, root: 'source' },
  allocate: { hashFrom: 'IdeaPage.hash', hash: 'raw', conflict: 'StaleIdea', refused: 'AllocateRefused', locked: 'Locked', runLocked: 'RunLocked', registered: true, root: 'main' },
  backlog: { hashFrom: 'PlanningModel.backlogHash', hash: 'raw', conflict: 'StaleBacklog', refused: 'BacklogRefused', locked: null, runLocked: null, registered: true, root: 'main' },
  runRelease: { hashFrom: ACTIVITY_HASH_HEADER, hash: 'raw', conflict: 'StaleActivity', refused: 'RunReleaseRefused', locked: null, runLocked: null, registered: true, root: 'main' },
} as const satisfies Record<WriteOperation, WriteTableEntry>;

/**
 * What one write may touch, relative to the root `WRITE_TABLE[op].root` names: the spec's read source (the main
 * checkout, or the worktree copy when the spec is read from it) for the three writes on an existing spec, the main
 * checkout for the rest. `specs/NNN-slug/` is the spec folder, `<slug>` the story's slug.
 */
export interface WritePaths {
  /** Written in place, with an fsync; no temp file, no rename. */
  readonly writes: readonly string[];
  /** Removed. */
  readonly removes: readonly string[];
  /** The one directory the write may create, or null. */
  readonly creates: string | null;
}

const FOLDER = 'specs/NNN-slug/';
const STORY = '<slug>';
const inFolder = (path: string): string => `${FOLDER}${path}`;

/**
 * The one constant naming every file an app write may touch; nothing outside it changes in a registered repository
 * (`tests/readonly.test.ts`). Built from core's file kinds, so a renamed file renames here.
 */
export const WRITE_PATHS = {
  gateReviewed: { writes: [inFolder(REVIEWED_MARK_PATH), inFolder(EVENTS_PATH)], removes: [], creates: inFolder('.gates/') },
  taskCheck: { writes: [inFolder(TASKS_PATH)], removes: [], creates: null },
  transition: { writes: [inFolder(SPEC_PATH), inFolder(EVENTS_PATH)], removes: [], creates: null },
  allocate: {
    writes: [inFolder(CONTEXT_PATH), inFolder(SPEC_PATH), inFolder(EVENTS_PATH)],
    removes: [`${FILE_KINDS.idea.repoPath ?? ''}${STORY}.md`],
    creates: FOLDER,
  },
  // The fifth path (T93): the feature-level code-review mark and one event line in each target folder, written only by
  // `spectant gate code-reviewed F<n>` (`feature-gate.ts`). No HTTP write, so no `WriteOperation` and no `WRITE_TABLE` row.
  codeReviewFeature: { writes: [inFolder(FILE_KINDS.gateCodeReviewed.path), inFolder(EVENTS_PATH)], removes: [], creates: inFolder('.gates/') },
  // The sixth path (spec 009): the repository's token measurement, rewritten in place only by `spectant tokens --yes`
  // (`tokens-cli.ts`), which takes its target from here. No HTTP write, so no `WriteOperation` and no `WRITE_TABLE` row.
  tokens: { writes: [FILE_KINDS.tokens.repoPath ?? ''], removes: [], creates: null },
  // The seventh path (spec 036): the feature backlog, rewritten in place, and its event log, appended, by the backlog
  // route (`writeBacklog`). Once per repository, at the main checkout; it creates no directory.
  backlog: { writes: [BACKLOG_PATH, BACKLOG_EVENTS_PATH], removes: [], creates: null },
  // The eighth path (spec 040, ISC-226): the run release, one `run-end` line with `outcome: released` appended to the
  // activity log by the release route (`writeRunRelease`). Once per repository, at the main checkout; never a rewrite,
  // and it creates no directory (the file holds the open run, so it exists).
  runRelease: { writes: [ACTIVITY_PATH], removes: [], creates: null },
} as const satisfies Record<WriteOperation | 'codeReviewFeature' | 'tokens', WritePaths>;

/** `WRITE_PATHS[op]` for one spec folder (`NNN-slug`) and, for `allocate`, the story's slug. */
export function writePathsOf(op: WriteOperation, folder: string, slug = ''): WritePaths {
  const fill = (path: string): string => path.replace(FOLDER, `specs/${folder}/`).replace(STORY, slug);
  const paths: WritePaths = WRITE_PATHS[op];
  return { writes: paths.writes.map(fill), removes: paths.removes.map(fill), creates: paths.creates === null ? null : fill(paths.creates) };
}

// ─── Requests ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface WriteRequests {
  gateReviewed: GateReviewedRequest;
  taskCheck: TaskCheckRequest;
  transition: TransitionRequest;
}

/** The gate body from the `X-Spectant-Reviewed-Hashes` value the page was rendered with; null when malformed. */
export function gateReviewedRequestFromHeader(header: string | null): GateReviewedRequest | null {
  const hashes = parseReviewedHashes(header);
  return hashes === null ? null : { hashes };
}

/** The checkbox body: the raw tasks.md hash (`X-Spectant-Tasks-Hash`) and the state wanted. */
export function taskCheckRequest(hash: string, checked: boolean): TaskCheckRequest {
  return { checked, hash };
}

export type ParsedWriteBody<R extends WriteRoute> =
  | { readonly ok: true; readonly body: WriteRequests[R] }
  | { readonly ok: false; readonly error: InvalidBody };

/** The request text as the route's body, or the 400 `invalid-body` answer. Never throws. */
export function parseWriteBody<R extends WriteRoute>(route: R, text: string): ParsedWriteBody<R> {
  const invalid = { ok: false, error: { error: 'invalid-body' } } as const;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return invalid;
  }
  const valid =
    route === 'gateReviewed' ? isGateReviewedRequest(data) : route === 'taskCheck' ? isTaskCheckRequest(data) : isTransitionRequest(data);
  return valid ? { ok: true, body: data as WriteRequests[R] } : invalid;
}
