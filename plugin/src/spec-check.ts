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
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { parseClaims } from '../../core/src/claims.ts';
import type { Claim } from '../../core/src/claims.ts';
import { buildDashboard } from '../../core/src/dashboard.ts';
import type { DashboardInput } from '../../core/src/dashboard.ts';
import { validateEventLine } from '../../core/src/events.ts';
import { FILE_KINDS } from '../../core/src/files.ts';
import type { EventLine, LockReading, SpecFiles, TextFileKind, WorkflowStage } from '../../core/src/files.ts';
import { SPEC_TYPES, parseFrontmatter } from '../../core/src/frontmatter.ts';
import { gateState, readGateMark, reviewedGate } from '../../core/src/gates.ts';
import { nextSpecNumber, specNumbersOf } from '../../core/src/allocate.ts';
import { readLockSources } from '../../core/src/locks.ts';
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
  readonly values: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
}

/** Every command takes these switches; `--json` and `--help` need no value. */
const COMMON_FLAGS = ['json', 'help'];

function parseArgs(argv: readonly string[], valueNames: readonly string[], flagNames: readonly string[]): Args {
  const positional: string[] = [];
  const values = new Map<string, string>();
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
    } else {
      throw bad(`unknown option --${name}`);
    }
  }
  return { positional, values, flags };
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

async function status(ctx: Context, args: Args): Promise<number> {
  const listed = listSpecs(ctx.root);
  const one = args.positional[0] === undefined ? null : specRef(ctx.root, args.positional[0]);
  if (one?.archived) throw bad(`${rel(ctx, one.dir)} is archived`);
  const active = listed.filter((s) => !s.archived).map(specFiles);
  const locks = await locksOf(ctx);
  const input: DashboardInput = {
    master: readIfExists(masterPath(ctx)),
    constitution: readIfExists(join(ctx.root, 'specs', 'constitution.md')),
    tldr: readIfExists(join(ctx.root, 'specs', 'tldr.md')),
    specs: active,
    archived: listed.filter((s) => s.archived).map(specFiles),
    worktreeTree: null,
    locks,
    workflow: parseWorkflow(readIfExists(join(ctx.root, 'specs', 'workflow.md'))),
  };
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
  const line = JSON.stringify(event);
  if (!validateEventLine(line).ok) throw bad(`the event line would be rejected: ${line}; nothing written`);
  const eventsPath = join(ref.dir, 'events.jsonl');
  const existing = readIfExists(eventsPath);
  const lead = existing !== null && existing !== '' && !existing.endsWith('\n') ? '\n' : '';
  writeFileSync(join(ref.dir, 'spec.md'), plan.specText);
  appendFileSync(eventsPath, `${lead}${line}\n`);
  emit(ctx, args, { spec: ref.slug, from: plan.from, to: plan.to, event }, [`${ref.slug}: ${plan.from} → ${plan.to} (${event.command})`]);
  return EXIT.ok;
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
  claim: { usage: 'claim <ISC-N> --session <actor>', summary: 'lock a claim in .spectant/activity.jsonl', later: 'T18' },
  release: { usage: 'release <ISC-N> --session <actor>', summary: 'release a claim lock', later: 'T18' },
  transition: {
    usage: 'transition <spec> <to> [--actor <actor>] [--command "<…>"] [--json]',
    summary:
      'move a spec to another stage: stage: in spec.md and one events.jsonl line. Files that already stand in <to> (plan.md, tasks.md or the last verification written first) get the one line from the last recorded stage. Called again once the last line enters <to>: exit 0, "already there", nothing written. Exit 3 and nothing written when the workflow or a gate refuses',
    values: ['actor', 'command'],
    run: transition,
  },
  run: { usage: 'run start <spec|idea> --command "<…>" | run end <run-id> --outcome ok|error', summary: 'open or close a run', later: 'T18' },
  gate: { usage: 'gate check reviewed|code-reviewed <spec> | gate reviewed <spec> --yes | gate code-reviewed <spec> --yes …', summary: 'check or set a gate mark', later: 'T22' },
  archive: { usage: 'archive <NNN>… [--dry-run] [--reason "<why>"] | archive restore <NNN>', summary: 'move specs to specs/archive/ and back', later: 'T24' },
  rounds: { usage: 'rounds record <spec> …', summary: 'append one rounds.jsonl line', later: 'T22' },
  activity: { usage: 'activity <event> …', summary: 'append one activity line (dispatch, build, patch, apply, probe, question)', later: 'T18' },
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
    throw error;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
