#!/usr/bin/env bun
// spec-check — the CLI of the Spec plugin (spec 031, T15/T16, ISC-41): `spec-check <command> [args] [--json]`.
//
// The skill calls it as `bun "${CLAUDE_PLUGIN_ROOT}/bin/spec-check" <command> …`; `bun run build:plugin` bundles this
// source, with the `core/` modules it imports inlined, to that path. Every read of the spec format and every text plan
// is `core/`'s (one parser, `bun run check:single-core`); this file only finds the repository, reads the files core
// needs, writes the texts core planned and prints the result.
//
// The repository root is the folder that holds the common git directory (`git rev-parse --git-common-dir`), so a call
// from a linked worktree reads and writes the main checkout's `specs/`, `ISA.md` and `.spectant/`, as the app does. It
// writes only under that root, reads nothing outside it but the claims file it is handed, and calls no network host.
//
// Exit codes: 0 ok · 1 bad arguments (or a plan core refused; nothing was written) · 3 drift or a gate open · 4 lock
// lost. `--json` prints one JSON object on stdout; without it the output is for a person.
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import {
  ActivityTextError,
  claimLine,
  newRunId,
  probeLine,
  questionLine,
  releaseLine,
  runEndLine,
  runEventLine,
  runStartLine,
} from '../../core/src/activity-text.ts';
import { parseClaims } from '../../core/src/claims.ts';
import type { Claim } from '../../core/src/claims.ts';
import { buildDashboard } from '../../core/src/dashboard.ts';
import type { DashboardInput } from '../../core/src/dashboard.ts';
import { validateEventLine } from '../../core/src/events.ts';
import { FILE_KINDS } from '../../core/src/files.ts';
import type { EventLine, LockReading, RunEvent, RunOutcome, SpecFiles, TextFileKind, WorkflowStage } from '../../core/src/files.ts';
import { SPEC_TYPES, parseFrontmatter } from '../../core/src/frontmatter.ts';
import { REVIEWED_FILES, codeReviewedMarkText, gateState, hashForGate, readGateMark, reviewedGate, reviewedMarkText, treeIdOf } from '../../core/src/gates.ts';
import type { GateCheck, ReviewedFile, TreeEntry, TreeEntryMode } from '../../core/src/gates.ts';
import { nextSpecNumber, specNumbersOf } from '../../core/src/allocate.ts';
import { activityReading, readLockSources } from '../../core/src/locks.ts';
import { listSpecs, resolveSpec } from '../../core/src/resolve.ts';
import type { SpecRef } from '../../core/src/resolve.ts';
import { resolveEdges } from '../../core/src/spec-edges.ts';
import { specIdOf, specSlugOf } from '../../core/src/spec-ref.ts';
import { WORKFLOW_STAGES, isWorkflowStage } from '../../core/src/stage.ts';
import {
  SpecTextError,
  appendDecisionText,
  appendVerificationText,
  mintClaimsText,
  projectClaimsText,
  specFolderText,
} from '../../core/src/spec-text.ts';
import type { SpecTextClaim, SpecTextRow, SpecTextType } from '../../core/src/spec-text.ts';
import { driftReport, hasDrift, mainFeatureOf, masterProgressMismatch, partitionClaims, specEdgeHolds } from '../../core/src/status.ts';
import type { ClaimPartition, DriftReport } from '../../core/src/status.ts';
import { takeableSet } from '../../core/src/takeable.ts';
import { parseTaskLines } from '../../core/src/tasks.ts';
import { roundLines } from '../../core/src/timeline.ts';
import { planCatchUp, planTransition } from '../../core/src/transition.ts';
import type { TransitionInput } from '../../core/src/transition.ts';
import { parseWorkflow } from '../../core/src/workflow.ts';

export const EXIT = { ok: 0, badArgs: 1, drift: 3, lockLost: 4 } as const;

/** A refusal with its exit code; the message goes to stderr. */
class CliError extends Error {
  readonly exit: number;

  constructor(exit: number, message: string) {
    super(message);
    this.name = 'CliError';
    this.exit = exit;
  }
}

const bad = (message: string): CliError => new CliError(EXIT.badArgs, message);

// ── arguments ───────────────────────────────────────────────────────────────────────────────────────────────────────

interface Args {
  readonly positional: readonly string[];
  /** The last value of each named option. */
  readonly values: ReadonlyMap<string, string>;
  /** Every value of each named option, in order: the repeatable ones (`--outcome T1=pass --outcome T2=fail`). */
  readonly lists: ReadonlyMap<string, readonly string[]>;
  readonly flags: ReadonlySet<string>;
}

/** Every command takes these switches; `--json` and `--help` need no value. */
const COMMON_FLAGS = ['json', 'help'];

function parseArgs(argv: readonly string[], valueNames: readonly string[], flagNames: readonly string[]): Args {
  const positional: string[] = [];
  const values = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (!arg.startsWith('--') || arg === '--') {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = arg.slice(2, eq < 0 ? undefined : eq);
    if ([...COMMON_FLAGS, ...flagNames].includes(name)) {
      if (eq >= 0) throw bad(`--${name} takes no value`);
      flags.add(name);
    } else if (valueNames.includes(name)) {
      const value = eq >= 0 ? arg.slice(eq + 1) : argv[(i += 1)];
      if (value === undefined) throw bad(`--${name} needs a value`);
      values.set(name, value);
      lists.set(name, [...(lists.get(name) ?? []), value]);
    } else {
      throw bad(`unknown option --${name}`);
    }
  }
  return { positional, values, lists, flags };
}

function required(args: Args, index: number, what: string): string {
  const value = args.positional[index];
  if (value === undefined || value === '') throw bad(`missing ${what}`);
  return value;
}

// ── the repository ──────────────────────────────────────────────────────────────────────────────────────────────────

interface Context {
  readonly cwd: string;
  readonly root: string;
  readonly now: Date;
  out(text: string): void;
}

function git(cwd: string, args: readonly string[]): string | null {
  const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  return r.exitCode === 0 ? r.stdout.toString() : null;
}

/** The main checkout's root: the parent of the common git directory; the current directory outside git. */
function repoRoot(cwd: string): string {
  const common = git(cwd, ['rev-parse', '--git-common-dir'])?.trim();
  return common === undefined || common === '' ? cwd : dirname(resolve(cwd, common));
}

function readIfExists(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** The text file kinds inside a spec folder, as the app's loader reads them. */
const FOLDER_KINDS = (Object.keys(FILE_KINDS) as Array<keyof typeof FILE_KINDS>).filter(
  (kind): kind is TextFileKind => !FILE_KINDS[kind].directory && !FILE_KINDS[kind].path.startsWith('..'),
);

function specFiles(ref: Pick<SpecRef, 'dir' | 'slug'>): SpecFiles {
  const texts: Partial<Record<TextFileKind, string>> = {};
  for (const kind of FOLDER_KINDS) {
    const text = readIfExists(join(ref.dir, FILE_KINDS[kind].path));
    if (text !== null) texts[kind] = text;
  }
  return { folder: ref.slug, texts };
}

/** The spec a ref names: `001`, `001-slug`, `slug`, or a path ending in the folder (`specs/001-slug/`). */
function specRef(root: string, arg: string): SpecRef {
  const name = basename(arg.replace(/[\\/]+$/u, ''));
  const ref = resolveSpec(root, name);
  if (ref.kind === 'not_found') throw bad(`no spec folder matches "${arg}" (${ref.reason})`);
  return ref;
}

const rel = (ctx: Context, path: string): string => relative(ctx.root, path).split(sep).join('/');

function specText(ctx: Context, ref: SpecRef): string {
  const text = readIfExists(join(ref.dir, 'spec.md'));
  if (text === null) throw bad(`${rel(ctx, ref.dir)} has no spec.md`);
  return text;
}

const masterPath = (ctx: Context): string => join(ctx.root, 'ISA.md');

async function locksOf(ctx: Context): Promise<LockReading> {
  return readLockSources({ repoRoot: ctx.root });
}

/** `--json`: one object; else the lines for a person. */
function emit(ctx: Context, args: Args, value: unknown, lines: readonly string[]): void {
  ctx.out(args.flags.has('json') ? JSON.stringify(value, null, 2) : lines.join('\n'));
}

// ── allocate ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The slug as a title: hyphens to spaces, the first letter upper-cased. */
function titleOf(slug: string): string {
  const words = slug.replace(/-+/gu, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Spec numbers taken by branch names `…/NNN-…`, local and remote, so a number a branch carries is never handed out. */
function branchNumbers(root: string): number[] {
  const names = (git(root, ['branch', '-a', '--format=%(refname:short)']) ?? '').split('\n');
  return specNumbersOf(names.flatMap((name) => name.trim().split('/').slice(1)));
}

function allocate(ctx: Context, args: Args): number {
  const type = required(args, 0, 'the spec type');
  const slug = required(args, 1, 'the slug');
  if (!(SPEC_TYPES as readonly string[]).includes(type)) throw bad(`"${type}" is no spec type (${SPEC_TYPES.join(', ')})`);
  const listed = listSpecs(ctx.root);
  const clash = listed.find((s) => specSlugOf(s.slug) === slug);
  if (clash) throw bad(`a spec folder for "${slug}" exists already: ${rel(ctx, clash.dir)}`);

  const number = nextSpecNumber([...specNumbersOf(listed.map((s) => s.slug)), ...branchNumbers(ctx.root)]);
  const title = args.values.get('title') ?? titleOf(slug);
  const goal = args.values.get('goal');
  const feature = args.values.get('feature');
  const plan = specFolderText({
    type: type as SpecTextType,
    number,
    slug,
    title,
    goal: goal ?? title,
    ...(feature === undefined ? {} : { feature }),
    now: ctx.now,
    actor: args.values.get('actor') ?? 'a:claude:spec-check',
  });
  const dir = join(ctx.root, ...plan.dir.split('/'));
  if (existsSync(dir)) throw bad(`${plan.dir} exists already`);
  mkdirSync(dir, { recursive: true });
  const files = Object.keys(plan.files) as Array<keyof typeof plan.files>;
  for (const name of files) writeFileSync(join(dir, name), plan.files[name]);
  emit(ctx, args, { dir: plan.dir, number, files }, [
    `allocated ${plan.dir} (${files.join(', ')})`,
    ...(goal === undefined ? ['no --goal given: the goal reads as the title; confirm it in spec.md and context.md'] : []),
  ]);
  return EXIT.ok;
}

// ── mint ────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface ClaimInput {
  readonly claim: SpecTextClaim;
  readonly row: SpecTextRow | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';

function claimInputs(path: string): ClaimInput[] {
  const text = readIfExists(path);
  if (text === null) throw bad(`the claims file ${basename(path)} does not exist`);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw bad(`the claims file ${basename(path)} is not valid JSON`);
  }
  if (!Array.isArray(data) || data.length === 0) throw bad('the claims file must hold a non-empty JSON array');
  return data.map((item: unknown, i) => {
    const at = `claim ${i + 1}`;
    if (!isRecord(item) || !isString(item.text)) throw bad(`${at}: needs a "text" string`);
    if (item.id !== undefined && !isString(item.id)) throw bad(`${at}: "id" must be a string`);
    if (item.after !== undefined && !(Array.isArray(item.after) && item.after.every(isString))) throw bad(`${at}: "after" must be a list of claim IDs`);
    const claim: SpecTextClaim = { text: item.text, ...(isString(item.id) ? { id: item.id } : {}), ...(Array.isArray(item.after) ? { after: item.after } : {}) };
    if (item.row === undefined || item.row === null) return { claim, row: null };
    const r = item.row;
    if (!isRecord(r) || ![r.type, r.check, r.threshold, r.tool, r.anchorsTo].every(isString)) {
      throw bad(`${at}: "row" needs the strings type, check, threshold, tool and anchorsTo`);
    }
    if (r.severity !== undefined && !isString(r.severity)) throw bad(`${at}: "row.severity" must be a string`);
    const row: SpecTextRow = {
      type: r.type as string,
      check: r.check as string,
      threshold: r.threshold as string,
      tool: r.tool as string,
      anchorsTo: r.anchorsTo as string,
      ...(isString(r.severity) ? { severity: r.severity } : {}),
    };
    return { claim, row };
  });
}

const ISC_NUMBER = /^ISC-(\d+)/u; // single-core: allow — the number of an ID parseClaims already parsed; no line is read

/** One past the highest top-level `ISC-N` any spec folder's claim lines carry: the next ID without a master. */
function nextIdAcrossSpecs(root: string): number {
  let highest = 0;
  for (const ref of listSpecs(root)) {
    const text = readIfExists(join(ref.dir, 'spec.md'));
    if (text === null) continue;
    for (const c of parseClaims(text).claims) highest = Math.max(highest, Number(ISC_NUMBER.exec(c.id)?.[1] ?? 0));
  }
  return highest + 1;
}

function mint(ctx: Context, args: Args): number {
  const ref = specRef(ctx.root, required(args, 0, 'the spec'));
  const feature = args.values.get('feature');
  if (feature === undefined || !/^F\d+(?:\.\d+)?$/u.test(feature)) throw bad('--feature F<n> is required');
  const claimsFile = args.values.get('claims');
  if (claimsFile === undefined) throw bad('--claims <json-file> is required');
  const inputs = claimInputs(resolve(ctx.cwd, claimsFile));
  const claims = inputs.map((i) => i.claim);
  const rows = inputs.map((i) => i.row);
  const featureName = args.values.get('feature-name');
  const why = args.values.get('why');
  const specPath = join(ref.dir, 'spec.md');
  const spec = specText(ctx, ref);
  const master = readIfExists(masterPath(ctx));

  if (master === null) {
    // No master: the IDs are numbered across every spec folder, and the claims go into the spec alone.
    let next = nextIdAcrossSpecs(ctx.root);
    const numbered = claims.map((c) => (c.id === undefined ? { ...c, id: `ISC-${next++}` } : c));
    const planned = mintClaimsText(spec, feature, numbered, rows);
    writeFileSync(specPath, planned.text);
    emit(ctx, args, { ids: planned.ids, master: false, spec: rel(ctx, specPath) }, [
      `minted ${planned.ids.join(', ')} into ${rel(ctx, specPath)}`,
      'no master ISA.md in this repository: the claims went into the spec only',
    ]);
    return EXIT.ok;
  }

  // Master first: both texts are planned before either is written, so a refused projection writes nothing.
  const minted = mintClaimsText(master, feature, claims, rows, {
    ...(featureName === undefined ? {} : { featureName }),
    ...(why === undefined ? {} : { why }),
  });
  const projected = projectClaimsText(
    spec,
    claims.map((c, i) => ({ ...c, id: minted.ids[i] ?? '' })),
    rows,
  );
  writeFileSync(masterPath(ctx), minted.text);
  writeFileSync(specPath, projected);
  emit(ctx, args, { ids: minted.ids, master: true, spec: rel(ctx, specPath) }, [
    `minted ${minted.ids.join(', ')} into ISA.md (${feature}), then projected them into ${rel(ctx, specPath)}`,
  ]);
  return EXIT.ok;
}

// ── verify, decide ──────────────────────────────────────────────────────────────────────────────────────────────────

function verify(ctx: Context, args: Args): number {
  const ref = specRef(ctx.root, required(args, 0, 'the spec'));
  const id = required(args, 1, 'the claim ID');
  const type = required(args, 2, 'the verification type');
  const stub = required(args, 3, 'the one-line stub');
  const specPath = join(ref.dir, 'spec.md');
  const nextSpec = appendVerificationText(specText(ctx, ref), id, type, stub, ctx.now);
  const master = readIfExists(masterPath(ctx));
  let nextMaster: string | null = null;
  if (master !== null) {
    if (!parseClaims(master).claims.some((c) => c.id === id)) {
      throw new CliError(EXIT.drift, `the master ISA.md holds no ${id}; nothing written — run spec-check drift`);
    }
    nextMaster = appendVerificationText(master, id, type, stub, ctx.now);
  }
  // The spec first, then the master; each text carries its evidence line before its checkmark.
  writeFileSync(specPath, nextSpec);
  if (nextMaster !== null) writeFileSync(masterPath(ctx), nextMaster);
  const files = [rel(ctx, specPath), ...(nextMaster === null ? [] : ['ISA.md'])];
  emit(ctx, args, { id, files }, [`verified ${id} in ${files.join(' and ')}`]);
  return EXIT.ok;
}

/** The file a decision goes to: a path (from the current directory or the root) inside the root, or a spec's spec.md. */
function decisionFile(ctx: Context, arg: string): string {
  for (const candidate of [resolve(ctx.cwd, arg), resolve(ctx.root, arg)]) {
    if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
    const inside = relative(ctx.root, candidate);
    if (inside.startsWith('..') || resolve(ctx.root, inside) !== candidate) throw bad(`${arg} lies outside the repository`);
    return candidate;
  }
  return join(specRef(ctx.root, arg).dir, 'spec.md');
}

function decide(ctx: Context, args: Args): number {
  const path = decisionFile(ctx, required(args, 0, 'the file'));
  const line = required(args, 1, 'the decision line');
  const text = readIfExists(path);
  if (text === null) throw bad(`${rel(ctx, path)} does not exist`);
  writeFileSync(path, appendDecisionText(text, line, ctx.now));
  emit(ctx, args, { file: rel(ctx, path) }, [`decision added to ${rel(ctx, path)}`]);
  return EXIT.ok;
}

// ── drift ───────────────────────────────────────────────────────────────────────────────────────────────────────────

function idsOf(text: string | null): Set<string> {
  return new Set(text === null ? [] : parseClaims(text).claims.map((c) => c.id));
}

function driftLines(slug: string, report: DriftReport): string[] {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(report) as Array<[string, unknown]>) {
    if (Array.isArray(value) && value.length > 0) lines.push(`  ${name}: ${value.map((v) => (isRecord(v) ? JSON.stringify(v) : String(v))).join(', ')}`);
    else if (isRecord(value)) lines.push(`  ${name}: ${JSON.stringify(value)}`);
    else if (typeof value === 'number' && value > 0) lines.push(`  ${name}: ${value}`);
  }
  return lines.length === 0 ? [] : [`${slug}:`, ...lines];
}

function drift(ctx: Context, args: Args): number {
  const listed = listSpecs(ctx.root);
  const one = args.positional[0];
  const targets = one === undefined ? listed.filter((s) => !s.archived) : [specRef(ctx.root, one)];
  const master = readIfExists(masterPath(ctx));
  const masterDoc = master === null ? null : parseClaims(master);
  const held = new Map(listed.map((s) => [s.slug, idsOf(readIfExists(join(s.dir, 'spec.md')))]));

  const specs: Array<{ id: string; slug: string; drift: boolean; report: DriftReport }> = [];
  for (const ref of targets) {
    const text = readIfExists(join(ref.dir, 'spec.md'));
    if (text === null) continue;
    const heldElsewhere = new Set([...held].filter(([slug]) => slug !== ref.slug).flatMap(([, ids]) => [...ids]));
    const report = driftReport({ frontmatter: parseFrontmatter(text), spec: parseClaims(text), master: masterDoc, heldElsewhere });
    specs.push({ id: ref.id, slug: ref.slug, drift: hasDrift(report), report });
  }
  // The master's own progress is a repository fact: audited on the repository-wide run, not per spec.
  const masterProgress = master === null || masterDoc === null || one !== undefined ? null : masterProgressMismatch(parseFrontmatter(master), masterDoc);
  const any = masterProgress !== null || specs.some((s) => s.drift);
  const lines = specs.flatMap((s) => driftLines(s.slug, s.report));
  if (masterProgress !== null) lines.push(`ISA.md: progress ${masterProgress.declared ?? 'missing'}, counted ${masterProgress.counted}`);
  if (master === null) lines.push('no master ISA.md: claim IDs are not checked against a master');
  emit(ctx, args, { drift: any, master: master !== null, masterProgress, specs }, any ? lines : [`drift: none (${specs.length} spec${specs.length === 1 ? '' : 's'})`, ...lines]);
  return any ? EXIT.drift : EXIT.ok;
}

// ── status, frontier ────────────────────────────────────────────────────────────────────────────────────────────────

function partitionView(p: ClaimPartition): Record<string, unknown> {
  return { closed: p.closed, open: p.open, takeable: p.takeable, gated: p.gated, blocked: p.blocked, taken: p.taken, dropped: p.dropped };
}

/** The dashboard's input over every spec folder of the root, as the app builds it, without a worktree tree id. */
function dashboardInput(ctx: Context, locks: LockReading): DashboardInput {
  const listed = listSpecs(ctx.root);
  return {
    master: readIfExists(masterPath(ctx)),
    constitution: readIfExists(join(ctx.root, 'specs', 'constitution.md')),
    tldr: readIfExists(join(ctx.root, 'specs', 'tldr.md')),
    specs: listed.filter((s) => !s.archived).map(specFiles),
    archived: listed.filter((s) => s.archived).map(specFiles),
    worktreeTree: null,
    locks,
    workflow: parseWorkflow(readIfExists(join(ctx.root, 'specs', 'workflow.md'))),
  };
}

async function status(ctx: Context, args: Args): Promise<number> {
  const one = args.positional[0] === undefined ? null : specRef(ctx.root, args.positional[0]);
  if (one?.archived) throw bad(`${rel(ctx, one.dir)} is archived`);
  const locks = await locksOf(ctx);
  const input = dashboardInput(ctx, locks);
  const active = input.specs;
  const model = buildDashboard(input);
  const rows = model.specs.filter((row) => one === null || row.slug === one.slug);
  const specs = rows.map((row) => {
    const texts = active.find((f) => f.folder === row.slug)?.texts ?? {};
    const reviewed = reviewedGate(texts).check.state;
    const partition = partitionClaims(parseClaims(texts.spec ?? '').claims, locks.locks, reviewed);
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      type: row.type,
      phase: row.phase,
      stage: row.stage,
      progress: `${row.progress.closed}/${row.progress.total}`,
      tasks: row.tasks,
      reviewed,
      next: row.nextCommand,
      reason: row.nextReason,
      partition: partitionView(partition),
    };
  });
  const lines = specs.map((s) => `${s.slug}  ${s.stage}  ${s.phase ?? '-'}  ${s.progress}${s.next === null ? '' : `  next: ${s.next} (${s.reason})`}`);
  emit(ctx, args, { specs }, lines.length === 0 ? ['no specs'] : lines);
  return EXIT.ok;
}

async function frontier(ctx: Context, args: Args): Promise<number> {
  const ref = specRef(ctx.root, required(args, 0, 'the spec'));
  const files = specFiles(ref);
  const text = files.texts.spec;
  if (text === undefined) throw bad(`${rel(ctx, ref.dir)} has no spec.md`);
  const claims: Claim[] = [...parseClaims(text).claims];
  const reviewed = reviewedGate(files.texts).check.state;
  const locks = (await locksOf(ctx)).locks;
  const constitution = readIfExists(join(ctx.root, 'specs', 'constitution.md'));
  const tasks =
    files.texts.tasks === undefined
      ? null
      : parseTaskLines({
          tasks: files.texts.tasks,
          ...(constitution === null ? {} : { constitution }),
          ...(files.texts.rounds === undefined ? {} : { rounds: files.texts.rounds }),
        });
  const partition = partitionClaims(claims, locks, reviewed);
  const set = takeableSet({ specType: parseFrontmatter(text).data.specType, claims, tasks, locks, reviewed, partition });
  const value = {
    spec: ref.slug,
    reviewed,
    takeable: set.claims,
    gated: partition.gated,
    blocked: partition.blocked,
    taken: partition.taken,
    width: set.width,
    dispatch: set.dispatch,
    held: set.held,
    tasks: set.tasks,
    exhausted: set.exhausted,
  };
  const lines = [
    `${ref.slug}: reviewed ${reviewed}; takeable ${set.claims.length === 0 ? 'none' : set.claims.join(', ')}`,
    ...set.dispatch.map((d) => `  dispatch ${d.task} (${d.claim}): ${d.reason}`),
    ...set.held.map((h) => `  held ${h.task} (${h.claim}): ${h.reason}`),
  ];
  emit(ctx, args, value, lines);
  return EXIT.ok;
}

// ── transition ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The plugin subcommand behind each command core's stage table names for a move: the one that makes it. The stage
 * table speaks the app's command names; the plugin records its own `/spec <subcommand> NNN` instead.
 */
const SUBCOMMAND_OF: Readonly<Record<string, string>> = {
  '/spec-plan': 'plan',
  '/spec-tasks': 'tasks',
  '/spec-review': 'review',
  '/spec-implement': 'implement',
  '/spec-status': 'implement',
  '/spec-code-review': 'review',
  '/spec-complete': 'done',
};

/** `/spec-plan 001` → `/spec plan 001`; a command without a mapping stays as core planned it. */
function pluginCommand(command: string): string {
  const [head = '', ...rest] = command.split(' ');
  const sub = SUBCOMMAND_OF[head];
  return sub === undefined ? command : ['/spec', sub, ...rest].join(' ');
}

/** Whether an active spec holds its main feature open: not complete, one claim neither checked nor dropped (dashboard row 7). */
function holdsFeatureOpen(files: SpecFiles): boolean {
  const spec = files.texts.spec;
  if (spec === undefined) return false;
  return parseFrontmatter(spec).data.phase !== 'complete' && parseClaims(spec).claims.some((c) => !c.checked && !c.dropped);
}

/**
 * `planTransition`'s input for one spec, built the way the app's stage write builds it (`server/src/writes.ts`
 * `transitionInput`): the reviewed mark's state, the claim partition under the lock reading counted as the dashboard
 * counts it, the open siblings of the main feature and the spec edges. The CLI has no worktree tree id and no branch
 * merge state, as `status` has none: the code-reviewed mark is read without a tree and the edges without merges.
 */
function transitionInput(ctx: Context, ref: SpecRef, to: WorkflowStage, actor: string, locks: LockReading): TransitionInput {
  const listed = listSpecs(ctx.root);
  const active = listed.filter((s) => !s.archived).map(specFiles);
  const archived = listed.filter((s) => s.archived).map(specFiles);
  const files = active.find((f) => f.folder === ref.slug) ?? specFiles(ref);
  const spec = files.texts.spec ?? '';
  const id = specIdOf(files.folder) ?? files.folder;
  const reviewed = reviewedGate(files.texts).check.state;
  const partition = partitionClaims(parseClaims(spec).claims, locks.locks, reviewed);
  const codeMark = files.texts.gateCodeReviewed === undefined ? null : readGateMark('code-reviewed', files.texts.gateCodeReviewed).mark;
  const edges = resolveEdges({ specs: active, archived, constitution: readIfExists(join(ctx.root, 'specs', 'constitution.md')) }, []);
  const edgeHeld = specEdgeHolds(
    partition.takeable,
    edges.edges.filter((e) => e.fromSpec === id),
  );
  const takeable = partition.takeable.filter((c) => !edgeHeld.has(c));
  const feature = mainFeatureOf(parseFrontmatter(spec).data.isaFeature);
  const siblings =
    feature === null
      ? []
      : active
          .filter((f) => f.texts.spec !== undefined && mainFeatureOf(parseFrontmatter(f.texts.spec).data.isaFeature) === feature && holdsFeatureOpen(f))
          .map((f) => specIdOf(f.folder) ?? f.folder)
          .filter((sibling) => sibling !== id)
          .sort();
  return {
    files,
    workflow: parseWorkflow(readIfExists(join(ctx.root, 'specs', 'workflow.md'))),
    to,
    actor,
    now: ctx.now,
    reviewed,
    codeReviewed: gateState('code-reviewed', codeMark, { worktreeTree: null }).state,
    partition: {
      takeable: takeable.length,
      open: partition.open.length - takeable.length,
      closed: partition.closed.length - partition.dropped.length,
      dropped: partition.dropped.length,
    },
    featureSiblingsOpen: siblings,
    waits: edges.waits.find((w) => w.spec === id) ?? null,
    edgeHeld: [...new Set([...edgeHeld.values()].flat())].sort(),
  };
}

/** The refusal of a planned move: exit 3 with core's reason and next command; nothing is written. */
function refusal(ref: SpecRef, plan: { readonly from: string; readonly reason: string; readonly command: string | null }): CliError {
  const next = plan.command === null ? '' : `; next: ${pluginCommand(plan.command)}`;
  return new CliError(EXIT.drift, `${ref.slug} stays in ${plan.from}: ${plan.reason}${next}; nothing written`);
}

/**
 * The stage move, the app's write path 3 without the app: core plans it (`planTransition`); on a refusal nothing is
 * written and the command exits 3 with core's reason and next command; on yes spec.md is written in place with its
 * `stage:` and exactly one event line is appended to `events.jsonl` (created when absent), a newline first when the
 * file does not end in one, as the app appends it.
 *
 * A subcommand writes the file that carries the spec on (plan.md, tasks.md, the last claim's verification) before it
 * records the move, so the files may already stand in `<to>`. Then core's catch-up (`planCatchUp`) records the move
 * late: the one event from the last recorded stage to `<to>`, exit 0. When the last event already enters `<to>` (the
 * same transition called twice), nothing is written and the command exits 0 with "already there".
 */
async function transition(ctx: Context, args: Args): Promise<number> {
  const ref = specRef(ctx.root, required(args, 0, 'the spec'));
  const to = required(args, 1, 'the target stage');
  if (!isWorkflowStage(to)) throw bad(`"${to}" is no stage (${WORKFLOW_STAGES.join(', ')})`);
  specText(ctx, ref);
  const actor = args.values.get('actor') ?? 'a:claude:spec-check';
  const input = transitionInput(ctx, ref, to, actor, await locksOf(ctx));
  const direct = planTransition(input);
  let plan: { readonly from: WorkflowStage; readonly to: WorkflowStage; readonly specText: string; readonly event: EventLine };
  if (direct.ok) plan = direct;
  else if (direct.from !== to) throw refusal(ref, direct);
  else {
    // The files already stand in `<to>`: record the move they made, once.
    const late = planCatchUp(input);
    if (late.kind === 'refused') throw refusal(ref, late);
    if (late.kind === 'recorded') {
      emit(ctx, args, { spec: ref.slug, from: to, to, event: null, already: true }, [`${ref.slug}: already there (${to}); nothing written`]);
      return EXIT.ok;
    }
    plan = late;
  }
  const event: EventLine = { ...plan.event, command: args.values.get('command') ?? pluginCommand(plan.event.command) };
  const line = checkedEvent(event);
  writeFileSync(join(ref.dir, 'spec.md'), plan.specText);
  appendEventLine(ref.dir, line);
  emit(ctx, args, { spec: ref.slug, from: plan.from, to: plan.to, event }, [`${ref.slug}: ${plan.from} → ${plan.to} (${event.command})`]);
  return EXIT.ok;
}

// ── the activity log: runs, locks, steps ────────────────────────────────────────────────────────────────────────────

/** The session a line names when the caller passes none: the CLI itself, in the actor grammar. */
const CLI_SESSION = 'a:claude:spec-check';

const activityPath = (ctx: Context): string => join(ctx.root, '.spectant', 'activity.jsonl');

const activityText = (ctx: Context): string => readIfExists(activityPath(ctx)) ?? '';

/**
 * Appends one line core planned to `.spectant/activity.jsonl` at the root (the folder created when absent), a newline
 * first when the file does not end in one. The root is the main checkout's, so a builder's worktree writes there too.
 */
function appendActivity(ctx: Context, line: string): void {
  const path = activityPath(ctx);
  mkdirSync(dirname(path), { recursive: true });
  const existing = readIfExists(path);
  const lead = existing !== null && existing !== '' && !existing.endsWith('\n') ? '\n' : '';
  appendFileSync(path, `${lead}${line}`);
}

function requiredValue(args: Args, name: string, what: string): string {
  const value = args.values.get(name);
  if (value === undefined || value === '') throw bad(`--${name} ${what} is required`);
  return value;
}

/** Every run id a `run-start` line of the log carries, open or ended: a second start with one is a duplicate. */
function startedRunIds(text: string): Set<string> {
  const ids = new Set<string>();
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    try {
      const line: unknown = JSON.parse(raw);
      if (isRecord(line) && line.event === 'run-start' && isString(line.run)) ids.add(line.run);
    } catch {
      // A malformed line is the reader's diagnostic, not a run.
    }
  }
  return ids;
}

/**
 * `run start <target> --command "<…>"`: one `run-start` line, the run id on stdout. The target is a spec (`NNN`,
 * `NNN-slug`, a folder path cut to its name), an idea's slug or `init`; core refuses any other form.
 */
function runStart(ctx: Context, args: Args): number {
  const target = basename(required(args, 1, 'the target (NNN, NNN-slug, an idea slug or init)').replace(/[\\/]+$/u, ''));
  const command = requiredValue(args, 'command', '"<the command as typed>"');
  const session = args.values.get('session') ?? CLI_SESSION;
  const ts = ctx.now.toISOString();
  const run = newRunId({ ts, session, command, target });
  const line = runStartLine({ run, target, command, session, ts });
  if (startedRunIds(activityText(ctx)).has(run)) throw bad(`the run ${run} was started already; nothing written`);
  appendActivity(ctx, line);
  emit(ctx, args, { run, target, command, session }, [run]);
  return EXIT.ok;
}

/**
 * `run end <run-id> --outcome ok|error`: one `run-end` line repeating the open run's command, session and target, as
 * the reader requires. An id that is not open (unknown or ended already) is refused and nothing is written.
 */
function runEnd(ctx: Context, args: Args): number {
  const run = required(args, 1, 'the run id');
  const outcome = requiredValue(args, 'outcome', 'ok|error');
  if (outcome !== 'ok' && outcome !== 'error') throw bad(`the outcome "${outcome}" is neither ok nor error`);
  const open = (activityReading(activityText(ctx)).openRuns ?? []).find((r) => r.run === run);
  if (open === undefined) throw bad(`no open run ${run} in .spectant/activity.jsonl (unknown or ended already); nothing written`);
  const session = args.values.get('session') ?? open.session;
  const target = open.spec ?? open.idea ?? '';
  const ended: RunOutcome = outcome;
  const line = runEndLine({ run, target, command: open.command, session, ts: ctx.now.toISOString(), outcome: ended });
  appendActivity(ctx, line);
  emit(ctx, args, { run, target, command: open.command, session, outcome }, [`${run} ended (${outcome})`]);
  return EXIT.ok;
}

function runCommand(ctx: Context, args: Args): number {
  const sub = required(args, 0, 'start or end');
  if (sub === 'start') return runStart(ctx, args);
  if (sub === 'end') return runEnd(ctx, args);
  throw bad(`"${sub}" is neither start nor end`);
}

/** The session holding `claim` per core's lock reader, or null. */
function holderOf(ctx: Context, claim: string): string | null {
  return activityReading(activityText(ctx)).locks.findLast((l) => l.claim === claim)?.session ?? null;
}

function lockInput(ctx: Context, args: Args): { claim: string; session: string; ts: string; task?: string; worktree?: string } {
  const claim = required(args, 0, 'the claim ID');
  const session = requiredValue(args, 'session', '<actor>');
  const task = args.values.get('task');
  const worktree = args.values.get('worktree');
  return { claim, session, ts: ctx.now.toISOString(), ...(task === undefined ? {} : { task }), ...(worktree === undefined ? {} : { worktree }) };
}

/** `claim <ISC-N> --session <actor>`: one `claim` line; exit 4 when another session holds it, nothing written. */
function lockClaim(ctx: Context, args: Args): number {
  const input = lockInput(ctx, args);
  const line = claimLine(input);
  const holder = holderOf(ctx, input.claim);
  if (holder !== null && holder !== input.session) throw new CliError(EXIT.lockLost, `lock held: ${input.claim} is held by ${holder}; nothing written`);
  if (holder === input.session) {
    emit(ctx, args, { claim: input.claim, session: input.session, already: true }, [`${input.claim}: held by ${input.session} already; nothing written`]);
    return EXIT.ok;
  }
  appendActivity(ctx, line);
  emit(ctx, args, { claim: input.claim, session: input.session, already: false }, [`${input.claim}: claimed by ${input.session}`]);
  return EXIT.ok;
}

/** `release <ISC-N> --session <actor>`: one `release` line by the holder; exit 4 when another session holds it. */
function lockRelease(ctx: Context, args: Args): number {
  const input = lockInput(ctx, args);
  const line = releaseLine(input);
  const holder = holderOf(ctx, input.claim);
  if (holder === null) {
    emit(ctx, args, { claim: input.claim, session: input.session, released: false }, [`${input.claim}: not held; nothing written`]);
    return EXIT.ok;
  }
  if (holder !== input.session) throw new CliError(EXIT.lockLost, `lock lost: ${input.claim} is held by ${holder}, not ${input.session}; nothing written`);
  appendActivity(ctx, line);
  emit(ctx, args, { claim: input.claim, session: input.session, released: true }, [`${input.claim}: released by ${input.session}`]);
  return EXIT.ok;
}

const STEP_EVENTS: readonly string[] = ['dispatch', 'build', 'patch', 'apply'] satisfies RunEvent[];

/** `activity <event> --task T<k> --session <actor> …`: one step line, planned by core for its event. */
function activity(ctx: Context, args: Args): number {
  const event = required(args, 0, 'the event (dispatch, build, patch, apply, probe or question)');
  const task = requiredValue(args, 'task', 'T<k>');
  const session = requiredValue(args, 'session', '<actor>');
  const claim = args.values.get('claim');
  const worktree = args.values.get('worktree');
  const common = { task, session, ts: ctx.now.toISOString(), ...(worktree === undefined ? {} : { worktree }) };
  const withClaim = claim === undefined ? {} : { claim };
  let line: string;
  if (event === 'probe') {
    const result = args.values.get('result');
    if (result !== 'red' && result !== 'green') throw bad('a probe needs --result red|green');
    line = probeLine({ ...common, claim: requiredValue(args, 'claim', 'ISC-N'), result });
  } else if (event === 'question') {
    line = questionLine({ ...common, ...withClaim, text: requiredValue(args, 'text', '"<the question>"') });
  } else if (STEP_EVENTS.includes(event)) {
    line = runEventLine({ ...common, ...withClaim, event: event as RunEvent });
  } else {
    throw bad(`"${event}" is none of dispatch, build, patch, apply, probe or question`);
  }
  appendActivity(ctx, line);
  emit(ctx, args, JSON.parse(line) as unknown, [`${event} ${task}${claim === undefined ? '' : ` (${claim})`} appended to .spectant/activity.jsonl`]);
  return EXIT.ok;
}

// ── rounds record ───────────────────────────────────────────────────────────────────────────────────────────────────

type RoundTaskState = 'held' | 'dispatched' | 'question' | 'concerns' | 'fail' | 'done' | 'closed';
const ROUND_OUTCOMES = ['result', 'question', 'failed', 'pass', 'concerns', 'fail', 'skipped'] as const;
type RoundOutcome = (typeof ROUND_OUTCOMES)[number];
type Verdict = 'pass' | 'concerns' | 'fail' | 'skipped';
const VERDICTS: ReadonlySet<string> = new Set<Verdict>(['pass', 'concerns', 'fail', 'skipped']);
const OPEN_ATTENTION: ReadonlySet<string> = new Set<RoundTaskState>(['question', 'concerns', 'fail']);
const ROUND_MODES = ['agent', 'workflow', 'cockpit'];

/** One card of a round line, in the field order the round log has always carried (frames.ts reads it). */
interface BoardTask {
  id: string;
  claim: string;
  lane: string | null;
  seam: boolean;
  parallel: boolean;
  text: string;
  paths: string[];
  state: RoundTaskState;
  reason?: string;
  verdict?: Verdict;
  note?: string;
  builder?: string;
  reader?: string;
}

interface RoundUnit {
  readonly id: string;
  readonly claim: string;
  readonly lane: string | null;
  readonly seam: boolean;
  readonly parallel: boolean;
  readonly text: string;
  readonly paths: readonly string[];
  readonly done: boolean;
}

interface PlanEntry {
  readonly id: string;
  readonly claim: string;
  readonly reason: string;
}

/** The round's plan: `frontier --json` (`task`) or the older plan shape (`id`, `claims.closed`). */
interface RoundPlan {
  readonly dispatch: readonly PlanEntry[];
  readonly held: readonly PlanEntry[];
  readonly width: number | null;
  readonly closed: readonly string[] | null;
}

interface RoundOutcomes {
  readonly outcome: Map<string, RoundOutcome>;
  readonly note: Map<string, string>;
  readonly builder: Map<string, string>;
  readonly reader: Map<string, string>;
}

const records = (value: unknown): Array<Record<string, unknown>> => (Array.isArray(value) ? value.filter(isRecord) : []);

function readJsonFile(ctx: Context, file: string, flag: string): unknown {
  const text = readIfExists(resolve(ctx.cwd, file));
  if (text === null) throw bad(`${flag} ${basename(file)} does not exist`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw bad(`${flag} ${basename(file)} is not valid JSON`);
  }
}

function planEntries(value: unknown, what: string): PlanEntry[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw bad(`--plan: "${what}" must be a list`);
  return value.map((entry: unknown, i) => {
    const id = isRecord(entry) ? (isString(entry.task) ? entry.task : entry.id) : undefined;
    if (!isRecord(entry) || !isString(id) || !isString(entry.claim)) throw bad(`--plan: ${what} ${i + 1} needs a task (or id) and a claim`);
    return { id, claim: entry.claim, reason: isString(entry.reason) ? entry.reason : '' };
  });
}

function roundPlan(data: unknown): RoundPlan {
  if (!isRecord(data)) throw bad('--plan must hold a JSON object');
  const closed = isRecord(data.claims) && Array.isArray(data.claims.closed) ? data.claims.closed.filter(isString) : null;
  return {
    dispatch: planEntries(data.dispatch, 'dispatch'),
    held: planEntries(data.held, 'held'),
    width: typeof data.width === 'number' ? data.width : null,
    closed,
  };
}

/** The workflow's return `{results, questions, failed}` (or the same shapes collected from agent returns). */
function outcomesFromResult(data: unknown, into: RoundOutcomes): void {
  if (!isRecord(data)) throw bad('--result must hold a JSON object {results, questions, failed}');
  for (const q of records(data.questions)) {
    if (!isString(q.task) || q.task === '') continue;
    into.outcome.set(q.task, 'question');
    if (isString(q.question)) into.note.set(q.task, q.question);
    if (isString(q.builder)) into.builder.set(q.task, q.builder);
  }
  for (const f of records(data.failed)) {
    if (!isString(f.task) || f.task === '') continue;
    into.outcome.set(f.task, 'failed');
    if (isString(f.reason)) into.note.set(f.task, f.reason);
    if (isString(f.builder)) into.builder.set(f.task, f.builder);
  }
  for (const x of records(data.results)) {
    if (!isString(x.task) || x.task === '') continue;
    const task = x.task;
    if (isString(x.builder)) into.builder.set(task, x.builder);
    if (isString(x.reader)) into.reader.set(task, x.reader);
    if (typeof x.exit_code === 'number' && x.exit_code !== 0) {
      into.outcome.set(task, 'failed');
      into.note.set(task, `probe exit ${x.exit_code}${isString(x.probe_command) ? ` — ${x.probe_command}` : ''}`);
      continue;
    }
    const verdict = isRecord(x.verdict) ? x.verdict : {};
    const v = verdict.verdict;
    into.outcome.set(task, isString(v) && VERDICTS.has(v) ? (v as Verdict) : 'result');
    const findings = records(verdict.findings);
    const worst = findings.find((f) => f.severity === 'critical') ?? findings.find((f) => f.severity === 'warning');
    if (worst !== undefined && isString(worst.issue)) into.note.set(task, `${String(worst.severity)}: ${worst.issue}`);
    else if (isString(x.stub)) into.note.set(task, x.stub);
  }
}

/** `--outcome T1=pass` and its kind: the task and the value, split at the first `=`. */
function pairs(args: Args, name: string): Array<[string, string]> {
  return (args.lists.get(name) ?? []).map((raw) => {
    const eq = raw.indexOf('=');
    if (eq <= 0) throw bad(`--${name} expects T<k>=<value>, got "${raw}"`);
    return [raw.slice(0, eq).trim(), raw.slice(eq + 1).trim()];
  });
}

/** The units of the board: tasks.md's task lines (struck ones left out), or without it the live claims. */
function roundUnits(ref: SpecRef, claims: readonly Claim[]): { units: RoundUnit[]; hasTasks: boolean } {
  const tasks = readIfExists(join(ref.dir, 'tasks.md'));
  if (tasks === null) {
    const units = claims
      .filter((c) => !c.dropped)
      .map((c) => ({ id: c.id, claim: c.id, lane: null, seam: false, parallel: false, text: c.text, paths: [], done: c.checked }));
    return { units, hasTasks: false };
  }
  const units = parseTaskLines({ tasks })
    .tasks.filter((t) => t.state !== 'struck')
    .map((t) => ({
      id: t.id,
      claim: t.claim,
      lane: t.lane === '' ? null : t.lane,
      seam: t.flags.seam,
      parallel: t.flags.parallel,
      text: t.text,
      paths: [...t.paths],
      done: t.state === 'done',
    }));
  return { units, hasTasks: true };
}

/**
 * `rounds record <spec>`: one line appended to `specs/NNN-slug/rounds.jsonl` after a round's write order, the whole
 * board as the round left it (frames.ts and timeline.ts read it). Everything in it is derived from the plan, the
 * outcomes and spec.md and tasks.md as they stand; it never writes them, takes no lock and starts no agent.
 */
function roundsRecord(ctx: Context, args: Args): number {
  const ref = specRef(ctx.root, required(args, 1, 'the spec'));
  const doc = parseClaims(specText(ctx, ref));
  const mode = args.values.get('mode') ?? 'agent';
  if (!ROUND_MODES.includes(mode)) throw bad(`--mode "${mode}" is none of ${ROUND_MODES.join(', ')}`);
  const ts = args.values.get('ts') ?? ctx.now.toISOString();
  if (Number.isNaN(Date.parse(ts))) throw bad(`--ts "${ts}" is not a date`);
  const planFile = args.values.get('plan');
  const plan = planFile === undefined ? null : roundPlan(readJsonFile(ctx, planFile, '--plan'));
  const outcomes: RoundOutcomes = { outcome: new Map(), note: new Map(), builder: new Map(), reader: new Map() };
  const resultFile = args.values.get('result');
  if (resultFile !== undefined) outcomesFromResult(readJsonFile(ctx, resultFile, '--result'), outcomes);
  for (const [task, o] of pairs(args, 'outcome')) {
    if (!(ROUND_OUTCOMES as readonly string[]).includes(o)) throw bad(`--outcome ${task}=${o}: expected one of ${ROUND_OUTCOMES.join(', ')}`);
    outcomes.outcome.set(task, o as RoundOutcome);
  }
  for (const [task, n] of pairs(args, 'note')) outcomes.note.set(task, n.replace(/\s+/gu, ' '));
  // The manual path for returns without a --result file; --result wins where both name a task.
  for (const [task, b] of pairs(args, 'builder')) if (!outcomes.builder.has(task)) outcomes.builder.set(task, b);
  for (const [task, r] of pairs(args, 'reader')) if (!outcomes.reader.has(task)) outcomes.reader.set(task, r);

  const { units, hasTasks } = roundUnits(ref, doc.claims);
  const logPath = join(ref.dir, 'rounds.jsonl');
  const existing = readIfExists(logPath);
  const prev = roundLines(existing ?? undefined).at(-1) as Record<string, unknown> | undefined;
  const prevById = new Map<string, Record<string, unknown>>();
  for (const t of records(prev?.tasks)) if (isString(t.id)) prevById.set(t.id, t);
  const stubs = new Map<string, string>();
  for (const v of doc.verification) if (!stubs.has(v.id)) stubs.set(v.id, v.text);
  const closed = new Set(doc.claims.filter((c) => c.checked && !c.dropped).map((c) => c.id));
  const live = doc.claims.filter((c) => !c.dropped);

  // A plan entry names a task, or without tasks.md a claim unit (`C<n>`) mapped back to its claim.
  const entries = [...(plan?.dispatch ?? []), ...(plan?.held ?? [])];
  const key = (e: PlanEntry): string => (hasTasks ? e.id : e.claim);
  const norm = (id: string): string => (hasTasks ? id : (entries.find((e) => e.id === id)?.claim ?? id));
  const planned = new Map<string, { reason: string; dispatched: boolean }>();
  for (const d of plan?.dispatch ?? []) planned.set(key(d), { reason: d.reason, dispatched: true });
  for (const h of plan?.held ?? []) planned.set(key(h), { reason: h.reason, dispatched: false });
  const normed = <T>(m: ReadonlyMap<string, T>): Map<string, T> => new Map([...m].map(([k, v]) => [norm(k), v]));
  const outcome = normed(outcomes.outcome);
  const note = normed(outcomes.note);
  const builderOf = normed(outcomes.builder);
  const readerOf = normed(outcomes.reader);
  const dispatched = new Set([...[...planned].filter(([, p]) => p.dispatched).map(([id]) => id), ...outcome.keys()]);

  const tasks = units.map((u): BoardTask => {
    const base: BoardTask = { id: u.id, claim: u.claim, lane: u.lane, seam: u.seam, parallel: u.parallel, text: u.text, paths: [...u.paths], state: 'held' };
    const p = planned.get(u.id);
    if (p !== undefined) base.reason = p.reason;
    const o = outcome.get(u.id);
    if (o !== undefined && VERDICTS.has(o)) base.verdict = o as Verdict;
    const n = note.get(u.id);
    if (n !== undefined) base.note = n;
    const b = builderOf.get(u.id);
    if (b !== undefined) base.builder = b;
    const r = readerOf.get(u.id);
    if (r !== undefined) base.reader = r;

    if (u.done) {
      base.state = closed.has(u.claim) ? 'closed' : 'done';
      const stub = stubs.get(u.claim);
      if (base.note === undefined && closed.has(u.claim) && stub !== undefined) base.note = stub;
      return base;
    }
    if (dispatched.has(u.id)) {
      if (o === 'question') base.state = 'question';
      else if (o === 'failed' || o === 'fail') base.state = 'fail';
      else if (o === 'concerns') base.state = 'concerns';
      else if (o === 'pass' || o === 'skipped' || o === 'result') base.state = closed.has(u.claim) ? 'closed' : 'done';
      else base.state = 'dispatched'; // no outcome yet: recorded mid-round, the worker is still out
      return base;
    }
    // Not in this round: an unanswered question or an open finding keeps its state until it is dispatched again.
    const was = prevById.get(u.id);
    if (was !== undefined && isString(was.state) && OPEN_ATTENTION.has(was.state)) {
      base.state = was.state as RoundTaskState;
      if (isString(was.verdict) && VERDICTS.has(was.verdict)) base.verdict = was.verdict as Verdict;
      if (base.note === undefined && isString(was.note)) base.note = was.note;
      if (base.builder === undefined && isString(was.builder)) base.builder = was.builder;
      if (base.reader === undefined && isString(was.reader)) base.reader = was.reader;
      base.reason ??= 'waiting — not dispatched again this round';
      return base;
    }
    base.reason ??= plan === null ? 'not dispatched' : "not in this round's plan";
    return base;
  });

  const prevClaims = isRecord(prev?.claims) && Array.isArray(prev.claims.closed) ? prev.claims.closed.filter(isString) : [];
  const before = new Set(plan?.closed ?? prevClaims);
  const stop = args.values.get('stop');
  const line = {
    v: 1,
    round: (typeof prev?.round === 'number' ? prev.round : 0) + 1,
    ts,
    mode,
    width: plan?.width ?? null,
    dispatched: units.filter((u) => dispatched.has(u.id)).map((u) => u.id),
    tasks,
    claims: {
      closed: [...closed],
      open: live.filter((c) => !c.checked).map((c) => c.id),
      closed_this_round: [...closed].filter((c) => !before.has(c)),
    },
    progress: `${closed.size}/${live.length}`,
    ...(stop === undefined || stop === '' ? {} : { stop }),
  };
  const lead = existing !== null && existing !== '' && !existing.endsWith('\n') ? '\n' : '';
  appendFileSync(logPath, `${lead}${JSON.stringify(line)}\n`);
  const landed = tasks.filter((t) => line.dispatched.includes(t.id)).map((t) => `${t.id} ${t.state}`);
  emit(ctx, args, { file: rel(ctx, logPath), line }, [
    `round ${line.round} → ${rel(ctx, logPath)} · dispatched ${landed.length === 0 ? 'none' : landed.join(', ')} · progress ${line.progress}${stop === undefined ? '' : ` · stop: ${stop}`}`,
  ]);
  return EXIT.ok;
}

function rounds(ctx: Context, args: Args): number {
  const sub = required(args, 0, 'record');
  if (sub !== 'record') throw bad(`"${sub}" is no rounds command (record)`);
  return roundsRecord(ctx, args);
}

// ── gates: the reviewed and the code-reviewed mark ──────────────────────────────────────────────────────────────────

type Gate = 'reviewed' | 'code-reviewed';

const gatePath = (ref: Pick<SpecRef, 'dir'>, gate: Gate): string => join(ref.dir, '.gates', `${gate}.json`);

const numberOf = (ref: Pick<SpecRef, 'slug'>): string => specIdOf(ref.slug) ?? ref.slug;

/** The subcommand that sets the gate: the next step a check names, and the command of the event the mark appends. */
const nextFor = (ref: Pick<SpecRef, 'slug'>, gate: Gate): string => (gate === 'reviewed' ? `/spec review ${numberOf(ref)}` : `/spec review ${numberOf(ref)} code`);

function checkedEvent(event: EventLine): string {
  const line = JSON.stringify(event);
  if (!validateEventLine(line).ok) throw bad(`the event line would be rejected: ${line}; nothing written`);
  return line;
}

/** One event line appended to the folder's `events.jsonl` (created when absent), a newline first when it lacks its last one. */
function appendEventLine(dir: string, line: string): void {
  const path = join(dir, 'events.jsonl');
  const existing = readIfExists(path);
  const lead = existing !== null && existing !== '' && !existing.endsWith('\n') ? '\n' : '';
  appendFileSync(path, `${lead}${line}\n`);
}

/**
 * Keeps `.gates/` out of git, as the old skill did: when the mark's path is not ignored, one `.gates/` line goes into
 * the `.gitignore` of the checkout holding the spec. A code-reviewed mark must lie outside the tree it names, or
 * writing it would make it stale; the reviewed mark lies beside it.
 */
function ensureGatesIgnored(ref: Pick<SpecRef, 'dir'>): 'ignored' | 'added' | 'no-git' {
  const top = git(ref.dir, ['rev-parse', '--show-toplevel'])?.trim();
  if (top === undefined || top === '') return 'no-git';
  const probe = relative(top, gatePath(ref, 'reviewed')).split(sep).join('/');
  if (git(top, ['-c', 'core.fsmonitor=false', 'check-ignore', '-q', '--', probe]) !== null) return 'ignored';
  const path = join(top, '.gitignore');
  const have = readIfExists(path) ?? '';
  const lead = have === '' || have.endsWith('\n') ? '' : '\n';
  appendFileSync(path, `${lead}# Spec: gate marks stay on this machine\n.gates/\n`);
  return 'added';
}

/** The checkout around the current directory as `git add -A && git write-tree` would see it, in memory. */
interface Checkout {
  readonly root: string;
  /** core's `treeIdOf` over the listed files; null when git could not list them. */
  readonly tree: string | null;
  readonly head: string | null;
  readonly branch: string | null;
}

/** One listed path as git would store it; null when it is gone or is no file (a submodule). */
function treeEntry(root: string, path: string): TreeEntry | null {
  const absolute = join(root, path);
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (stat.isSymbolicLink()) return { path, mode: '120000', bytes: readlinkSync(absolute, { encoding: 'buffer' }) };
  if (!stat.isFile()) return null;
  const mode: TreeEntryMode = (stat.mode & 0o100) === 0 ? '100644' : '100755';
  return { path, mode, bytes: readFileSync(absolute) };
}

/** The paths `ls-files -z` printed, without an untracked nested repository (`dir/`). */
const listedPaths = (out: string | null): string[] => [...new Set((out ?? '').split('\0'))].filter((p) => p !== '' && !p.endsWith('/'));

function checkoutOf(cwd: string): Checkout | null {
  const root = git(cwd, ['rev-parse', '--show-toplevel'])?.trim();
  if (root === undefined || root === '') return null;
  const word = (out: string | null): string | null => {
    const value = out?.trim() ?? '';
    return value === '' ? null : value;
  };
  const head = word(git(root, ['rev-parse', '--verify', '-q', 'HEAD']));
  const branch = word(git(root, ['rev-parse', '--abbrev-ref', 'HEAD']));
  const paths = git(root, ['-c', 'core.fsmonitor=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (paths === null) return { root, tree: null, head, branch };
  return { root, tree: treeIdOf(listedPaths(paths).flatMap((p) => treeEntry(root, p) ?? [])), head, branch };
}

/**
 * The paths of the checkout that differ from the commit the code review saw (the mark's `head`), untracked ones
 * included. The tree the mark names exists only as an id, never as a git object, so the reviewed commit is the nearest
 * thing to compare with: a path already changed at review time is listed too.
 */
function changedSince(checkout: Checkout, head: string | null): string[] {
  const tracked = head === null ? null : git(checkout.root, ['-c', 'core.fsmonitor=false', 'diff', '--name-only', '-z', head, '--']);
  const untracked = git(checkout.root, ['-c', 'core.fsmonitor=false', 'ls-files', '-z', '--others', '--exclude-standard']);
  return [...new Set([...listedPaths(tracked), ...listedPaths(untracked)])].sort();
}

/** A mark's check and why it reads so: the changed files, or the diagnostics of a mark that could not be read. */
function gateCheckOf(ctx: Context, ref: SpecRef, gate: Gate): { check: GateCheck; problems: string[] } {
  const text = readIfExists(gatePath(ref, gate));
  const reading = text === null ? null : readGateMark(gate, text);
  const problems = reading !== null && reading.mark === null ? reading.diagnostics.map((d) => d.message) : [];
  if (gate === 'reviewed') return { check: reviewedGate(specFiles(ref).texts).check, problems };
  const checkout = checkoutOf(ctx.cwd);
  const check = gateState(gate, reading?.mark ?? null, { worktreeTree: checkout?.tree ?? null });
  if (check.state !== 'stale') return { check, problems };
  if (checkout?.tree == null) return { check, problems: [...problems, 'the tree id of the working tree could not be computed'] };
  const head = reading?.mark?.gate === 'code-reviewed' ? reading.mark.head : null;
  return { check: { ...check, changed: changedSince(checkout, head) }, problems };
}

/** `gate check reviewed|code-reviewed <spec>`: exit 0 on a fresh mark, 3 on a missing or stale one, with the next step. */
function gateCheck(ctx: Context, args: Args): number {
  const gate = required(args, 1, 'the gate (reviewed or code-reviewed)');
  if (gate !== 'reviewed' && gate !== 'code-reviewed') throw bad(`"${gate}" is no gate (reviewed, code-reviewed)`);
  const ref = specRef(ctx.root, required(args, 2, 'the spec'));
  specText(ctx, ref);
  const { check, problems } = gateCheckOf(ctx, ref, gate);
  const next = check.state === 'fresh' ? null : nextFor(ref, gate);
  const mark = rel(ctx, gatePath(ref, gate));
  let line: string;
  if (check.state === 'fresh') line = `${ref.slug}: ${gate} mark fresh (${check.at ?? 'no time'})`;
  else if (check.state === 'missing') line = `${ref.slug}: not ${gate}, no readable ${mark}${problems.length > 0 ? ` (${problems.join('; ')})` : ''}`;
  else {
    const why = check.changed.length > 0 ? `changed since: ${check.changed.join(', ')}` : problems.join('; ') || 'the working tree changed';
    line = `${ref.slug}: the ${gate} mark is stale, ${why}`;
  }
  emit(ctx, args, { spec: ref.slug, gate, state: check.state, at: check.at, changed: check.changed, problems, next }, next === null ? [line] : [line, `next: ${next}`]);
  return check.state === 'fresh' ? EXIT.ok : EXIT.drift;
}

const needsYes = (ctx: Context, ref: SpecRef, gate: Gate): CliError =>
  bad(`gate ${gate} needs --yes: it writes ${rel(ctx, gatePath(ref, gate))} and appends to events.jsonl; nothing written`);

/**
 * `gate reviewed <spec> --yes`: the app's write path 1 without the app. The mark over the three files as they stand
 * (`reviewedMarkText`, the app's bytes), then exactly one event line for the move the mark makes, in the stage table's
 * names `review → build` (FORMAT.md, "Mark reviewed"), at the mark's time. The mark first: a failure between the two
 * leaves a mark without its event, never an event without a mark. No lock is read: the command runs inside the run of
 * the subcommand that asked the user.
 */
function gateReviewed(ctx: Context, args: Args, ref: SpecRef): number {
  if (!args.flags.has('yes')) throw needsYes(ctx, ref, 'reviewed');
  specText(ctx, ref);
  const texts = specFiles(ref).texts;
  const textOf: Record<ReviewedFile, string | undefined> = { 'spec.md': texts.spec, 'plan.md': texts.plan, 'tasks.md': texts.tasks };
  const files = {} as Record<ReviewedFile, string | null>;
  for (const f of REVIEWED_FILES) {
    const text = textOf[f];
    files[f] = text === undefined ? null : hashForGate(f, text);
  }
  const at = ctx.now.toISOString();
  const event: EventLine = { ts: at, from: 'review', to: 'build', command: args.values.get('command') ?? nextFor(ref, 'reviewed'), actor: args.values.get('actor') ?? CLI_SESSION };
  const line = checkedEvent(event);
  const mark = reviewedMarkText(at, files);
  const gitignore = ensureGatesIgnored(ref);
  mkdirSync(join(ref.dir, '.gates'), { recursive: true });
  writeFileSync(gatePath(ref, 'reviewed'), mark);
  appendEventLine(ref.dir, line);
  const ignored = gitignore === 'added' ? '; .gitignore: added .gates/' : '';
  emit(ctx, args, { spec: ref.slug, gate: 'reviewed', at, files, event, gitignore }, [
    `${ref.slug}: reviewed (${rel(ctx, gatePath(ref, 'reviewed'))}); review → build (${event.command})${ignored}`,
  ]);
  return EXIT.ok;
}

function countValue(args: Args, name: string): number {
  const raw = requiredValue(args, name, 'N (the accepted open findings)');
  if (!/^\d+$/u.test(raw)) throw bad(`--${name} "${raw}" is no non-negative integer`);
  return Number(raw);
}

/**
 * `gate code-reviewed <spec> --yes --code N --security N [--note "…"]`: the per-spec code-review mark, without `scope`
 * (the feature-scope mark is the app's own CLI). When the spec stands in `code-review`, one `code-review → close` line
 * first, so the tree the mark names holds it; then the tree id of the current checkout, computed in memory, and the
 * mark (`codeReviewedMarkText`).
 */
async function gateCodeReviewed(ctx: Context, args: Args, ref: SpecRef): Promise<number> {
  if (!args.flags.has('yes')) throw needsYes(ctx, ref, 'code-reviewed');
  const code = countValue(args, 'code');
  const security = countValue(args, 'security');
  specText(ctx, ref);
  if (checkoutOf(ctx.cwd) === null) throw bad('not inside a git checkout: a code-reviewed mark names a git tree; nothing written');
  const at = ctx.now.toISOString();
  const actor = args.values.get('actor') ?? CLI_SESSION;
  const row = buildDashboard(dashboardInput(ctx, await locksOf(ctx))).specs.find((r) => r.slug === ref.slug);
  const event: EventLine | null =
    row?.stage === 'code-review' ? { ts: at, from: 'code-review', to: 'close', command: args.values.get('command') ?? nextFor(ref, 'code-reviewed'), actor } : null;
  const line = event === null ? null : checkedEvent(event);
  const gitignore = ensureGatesIgnored(ref);
  if (line !== null) appendEventLine(ref.dir, line);
  const checkout = checkoutOf(ctx.cwd);
  if (checkout?.tree == null) throw bad(`the tree id of the working tree could not be computed${line === null ? '' : ' after the event line was appended'}; no mark written`);
  const note = args.values.get('note');
  const mark = codeReviewedMarkText({ at, actor, tree: checkout.tree, head: checkout.head, branch: checkout.branch, code, security, ...(note === undefined ? {} : { note }) });
  mkdirSync(join(ref.dir, '.gates'), { recursive: true });
  writeFileSync(gatePath(ref, 'code-reviewed'), mark);
  const on = checkout.branch === null ? '' : ` on ${checkout.branch}`;
  const moved = event === null ? '' : '; code-review → close';
  const ignored = gitignore === 'added' ? '; .gitignore: added .gates/' : '';
  emit(ctx, args, { spec: ref.slug, gate: 'code-reviewed', at, tree: checkout.tree, head: checkout.head, branch: checkout.branch, code, security, event, gitignore }, [
    `${ref.slug}: code-reviewed at tree ${checkout.tree.slice(0, 12)}${on} (code ${code}, security ${security})${moved}${ignored}`,
  ]);
  return EXIT.ok;
}

async function gateCommand(ctx: Context, args: Args): Promise<number> {
  const sub = required(args, 0, 'check, reviewed or code-reviewed');
  if (sub === 'check') return gateCheck(ctx, args);
  if (sub !== 'reviewed' && sub !== 'code-reviewed') throw bad(`"${sub}" is neither check, reviewed nor code-reviewed`);
  const ref = specRef(ctx.root, required(args, 1, 'the spec'));
  if (ref.archived) throw bad(`${rel(ctx, ref.dir)} is archived; nothing written`);
  return sub === 'reviewed' ? gateReviewed(ctx, args, ref) : gateCodeReviewed(ctx, args, ref);
}

// ── the router ──────────────────────────────────────────────────────────────────────────────────────────────────────

interface Command {
  readonly usage: string;
  readonly summary: string;
  readonly values?: readonly string[];
  readonly flags?: readonly string[];
  readonly run?: (ctx: Context, args: Args) => number | Promise<number>;
  /** The task of a later round that builds it; the command exits 1 until then. */
  readonly later?: string;
}

const COMMANDS: Readonly<Record<string, Command>> = {
  allocate: {
    usage: 'allocate <type> <slug> [--goal "<one sentence>"] [--title "<title>"] [--feature F<n>] [--actor <actor>] [--json]',
    summary: 'new spec folder specs/NNN-slug/ with spec.md, context.md and events.jsonl; the number is one past every folder, archived folder and NNN branch',
    values: ['goal', 'title', 'feature', 'actor'],
    run: allocate,
  },
  mint: {
    usage: 'mint <spec> --feature F<n> --claims <json-file> [--feature-name "<name>" --why "<why>"] [--json]',
    summary: 'mint claims into the master ISA.md first, then project them into the spec; without a master, into the spec only. JSON: [{text, after?, row: {type, check, threshold, tool, anchorsTo, severity?}}]',
    values: ['feature', 'claims', 'feature-name', 'why'],
    run: mint,
  },
  verify: {
    usage: 'verify <spec> <ISC-N> <type> "<one-line stub>" [--json]',
    summary: 'Verification line in the spec, then the master; ticks the claim and recounts progress',
    run: verify,
  },
  decide: {
    usage: 'decide <file|spec> "<line>" [--json]',
    summary: 'append one dated row to ## Decisions',
    run: decide,
  },
  drift: {
    usage: 'drift [NNN] [--json]',
    summary: 'audit specs against the master ISA.md; exit 3 on drift',
    run: drift,
  },
  status: {
    usage: 'status [NNN] [--json]',
    summary: 'phase, stage, progress and claim partition per spec (all active specs without NNN)',
    run: status,
  },
  frontier: {
    usage: 'frontier <spec> [--json]',
    summary: 'takeable claims and tasks of one spec, with what holds the rest',
    run: frontier,
  },
  claim: {
    usage: 'claim <ISC-N> [--task T<k>] --session <actor> [--worktree <path>] [--json]',
    summary: 'lock a claim in .spectant/activity.jsonl; exit 4 and nothing written when another session holds it',
    values: ['task', 'session', 'worktree'],
    run: lockClaim,
  },
  release: {
    usage: 'release <ISC-N> [--task T<k>] --session <actor> [--worktree <path>] [--json]',
    summary: 'release a claim lock the session holds; exit 4 and nothing written when another session holds it',
    values: ['task', 'session', 'worktree'],
    run: lockRelease,
  },
  transition: {
    usage: 'transition <spec> <to> [--actor <actor>] [--command "<…>"] [--json]',
    summary:
      'move a spec to another stage: stage: in spec.md and one events.jsonl line. Files that already stand in <to> (plan.md, tasks.md or the last verification written first) get the one line from the last recorded stage. Called again once the last line enters <to>: exit 0, "already there", nothing written. Exit 3 and nothing written when the workflow or a gate refuses',
    values: ['actor', 'command'],
    run: transition,
  },
  run: {
    usage: 'run start <NNN|NNN-slug|idea-slug|init> --command "<…>" [--session <actor>] [--json] | run end <run-id> --outcome ok|error [--session <actor>] [--json]',
    summary:
      'open a run (one run-start line, prints the run id) or close it (one run-end line with the start\'s command and target, also on an error); an id that is not open exits 1, nothing written',
    values: ['command', 'session', 'outcome'],
    run: runCommand,
  },
  gate: {
    usage:
      'gate check reviewed|code-reviewed <spec> [--json] | gate reviewed <spec> --yes [--actor <actor>] [--command "<…>"] [--json] | gate code-reviewed <spec> --yes --code N --security N [--note "<…>"] [--actor <actor>] [--json]',
    summary:
      'check a gate mark (exit 0 fresh; 3 missing or stale, with the changed files and the next step) or set one: reviewed writes .gates/reviewed.json and one review → build line in events.jsonl; code-reviewed writes the per-spec .gates/code-reviewed.json over the tree id of the checkout, one code-review → close line first when the spec stands in code-review. Without --yes nothing is written, exit 1',
    values: ['actor', 'command', 'code', 'security', 'note'],
    flags: ['yes'],
    run: gateCommand,
  },
  archive: { usage: 'archive <NNN>… [--dry-run] [--reason "<why>"] | archive restore <NNN>', summary: 'move specs to specs/archive/ and back', later: 'T24' },
  rounds: {
    usage:
      'rounds record <spec> [--plan <file>] [--result <file>] [--outcome T<k>=<o>]… [--note T<k>=<text>]… [--builder T<k>=<name>]… [--reader T<k>=<name>]… [--mode agent|workflow|cockpit] [--stop "<reason>"] [--ts <iso>] [--json]',
    summary:
      'append one round to rounds.jsonl after the write order: the whole board from the plan (frontier --json), the outcomes (result, question, failed, pass, concerns, fail, skipped) and spec.md and tasks.md as they stand',
    values: ['plan', 'result', 'outcome', 'note', 'builder', 'reader', 'mode', 'stop', 'ts'],
    run: rounds,
  },
  activity: {
    usage:
      'activity <dispatch|build|patch|apply|probe|question> --task T<k> [--claim ISC-N] --session <actor> [--result red|green] [--text "<…>"] [--worktree <path>] [--json]',
    summary: 'append one step line to .spectant/activity.jsonl (patch and apply need --worktree, probe --claim and --result, question --text)',
    values: ['task', 'claim', 'session', 'result', 'text', 'worktree'],
    run: activity,
  },
};

function help(): string {
  const width = Math.max(...Object.keys(COMMANDS).map((n) => n.length));
  return [
    'spec-check <command> [args] [--json]',
    '',
    ...Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(width)}  ${c.summary}${c.later === undefined ? '' : ' (not built yet)'}`),
    '',
    'spec-check <command> --help shows one command. Exit: 0 ok, 1 bad arguments, 3 drift or gate open, 4 lock lost.',
  ].join('\n');
}

export async function main(argv: readonly string[], cwd = process.cwd(), now = new Date()): Promise<number> {
  const out = (text: string) => process.stdout.write(`${text}\n`);
  const fail = (code: number, message: string) => {
    process.stderr.write(`spec-check: ${message}\n`);
    return code;
  };
  const [name, ...rest] = argv;
  if (name === undefined || name === '--help' || name === '-h' || name === 'help') {
    out(help());
    return name === undefined ? EXIT.badArgs : EXIT.ok;
  }
  const command = COMMANDS[name];
  if (command === undefined) return fail(EXIT.badArgs, `unknown command "${name}"\n\n${help()}`);
  if (rest.includes('--help') || rest.includes('-h')) {
    out(`spec-check ${command.usage}\n\n${command.summary}`);
    return EXIT.ok;
  }
  if (command.run === undefined) return fail(EXIT.badArgs, `${name}: not built yet (T18/T20/T22/T24; this one in ${command.later ?? 'a later round'})`);
  try {
    const args = parseArgs(rest, command.values ?? [], command.flags ?? []);
    return await command.run({ cwd, root: repoRoot(cwd), now, out }, args);
  } catch (error) {
    if (error instanceof CliError) return fail(error.exit, `${name}: ${error.message}`);
    if (error instanceof SpecTextError) return fail(EXIT.badArgs, `${name}: ${error.message} (${error.code}); nothing written`);
    if (error instanceof ActivityTextError) return fail(EXIT.badArgs, `${name}: ${error.message} (${error.code}); nothing written`);
    throw error;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
