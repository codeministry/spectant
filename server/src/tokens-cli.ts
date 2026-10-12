/**
 * The token baseline's measuring run (spec 009, T7, ISC-135): `spectant tokens [--root DIR] [--transcripts DIR] [--yes]`.
 *
 * 1. The root must hold a `specs/` folder (exit 1 otherwise; nothing is created).
 * 2. The transcript folder is `--transcripts DIR`, or `<config>/projects/<encoded root>/` with `<config>` the
 *    `$CLAUDE_CONFIG_DIR` or `~/.claude` and the root encoded as Claude Code encodes it (`encodeProjectPath`). Read
 *    from it: the main sessions `<session>.jsonl`, the sub-agents `<session>/subagents/agent-<id>.jsonl` with the
 *    `toolUseId` of their `agent-<id>.meta.json`, the sessions of every sibling folder named exactly
 *    `<folder>--claude-worktrees-agent-<id>` (the repository's agent worktrees), and every sibling folder named exactly
 *    `<folder>-NNN` with three digits (its spec worktrees `../<root>-NNN`), read like the folder itself: main sessions
 *    and their sub-agents. A folder that cannot be read is exit 1;
 *    a single file that cannot be read is a diagnostic. Every list is sorted in byte order, so nothing depends on the
 *    order `readdir` happens to return.
 * 3. The repository side comes from the workspace loader (`readWorkspaceInput`): each spec folder's `events.jsonl` and
 *    `rounds.jsonl` texts and its derived stage from core's dashboard model, plus an existing `specs/tokens.jsonl`.
 * 4. Everything is measured in core (`core/src/tokens.ts`): the existing file read back (`readTokens`), the run
 *    (`tokenRows`), the baseline lines merged (`mergeBaselines`) and the file text serialised (`serializeTokens`).
 *    Nothing of a transcript, an event or a round line is parsed here. A throw from core is one stderr line and exit 1.
 * 5. Diagnostics go to stderr and never change the exit code. Without `--yes` the command prints what it would write
 *    (path, line counts, totals) and exits 0; with `--yes` it writes `specs/tokens.jsonl` in place through `writes.ts`
 *    (open, write, fsync, close; no temp file), creating the file when absent.
 *
 * It never opens the app's data directory, the database or the network.
 */
import { type Dirent, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { buildDashboard } from "../../core/src/dashboard.ts";
import {
  type BaselineRow,
  TOKEN_COUNTERS,
  TOKEN_ROW_KINDS,
  type TokenCounters,
  type TokenDiagnostic,
  type TokenRow,
  type TokenRowKind,
  type TokenSpecInput,
  type TranscriptFile,
  mergeBaselines,
  readTokens,
  serializeTokens,
  tokenRows,
} from "../../core/src/tokens.ts";
import { readIfExists, readWorkspaceInput, unreadableCode } from "./workspace-loader.ts";
import { WRITE_PATHS } from "./writes.contract.ts";
import { writeInPlace } from "./writes.ts";

type Env = Record<string, string | undefined>;

/** The infix between a repository's encoded root and an agent worktree's id in a sibling project folder's name. */
export const WORKTREE_INFIX = "--claude-worktrees-agent-";

/** An agent worktree id: letters and digits only, so a folder of a path nested below a worktree is not taken for one. */
const WORKTREE_ID = /^[A-Za-z0-9]+$/;

/**
 * What follows the encoded root in a spec worktree's project folder (`../<root>-NNN` encodes to `<encoded root>-NNN`):
 * `-` and exactly three digits, so `-0123` and `-012--claude-worktrees-agent-<id>` are not one.
 */
const SPEC_WORKTREE_SUFFIX = /^-\d{3}$/;

/** A sub-agent transcript's file name and the meta file beside it. */
const SUBAGENT_FILE = /^(agent-.+)\.jsonl$/;

/** The repository-relative path of the measurement file: the one file of the sixth write path, `WRITE_PATHS.tokens`. */
export const TOKENS_PATH: string = WRITE_PATHS.tokens.writes[0];

/** A transcript folder that cannot be listed: the run has nothing to measure, so the command ends with exit 1. */
export class TranscriptFolderError extends Error {
  constructor(readonly code: string) {
    super(`the transcript folder cannot be read (${code})`);
  }
}

/** A project path as Claude Code names its folder under `projects/`: every character but a letter or digit is `-`. */
export function encodeProjectPath(path: string): string {
  return path.replace(/[^A-Za-z0-9]/g, "-");
}

/** Claude Code's config directory: `$CLAUDE_CONFIG_DIR` when set and not empty, `~/.claude` otherwise. */
export function claudeConfigDir(env: Env, home: string = homedir()): string {
  const configured = env.CLAUDE_CONFIG_DIR;
  return configured !== undefined && configured !== "" ? configured : join(home, ".claude");
}

/** The project folder Claude Code keeps the sessions of the repository at `root` in. */
export function defaultTranscriptFolder(root: string, env: Env, home: string = homedir()): string {
  return join(claudeConfigDir(env, home), "projects", encodeProjectPath(root));
}

/** Byte order, so the file lists never depend on locale or `readdir` order. */
function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

function sortedEntries(dir: string): Dirent[] {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => byteOrder(a.name, b.name));
}

export interface TranscriptDiscovery {
  readonly files: TranscriptFile[];
  readonly diagnostics: TokenDiagnostic[];
}

/**
 * Every transcript of the project folder `folder` and of its agent and spec worktrees' sibling folders, in a fixed
 * order: the folder's entries in byte order (a session's sub-agent folder `<session>` sorts before its
 * `<session>.jsonl`), then each sibling folder in byte order, a spec worktree's entries read the same way as the
 * folder's. Labels are paths relative to `folder`. Throws `TranscriptFolderError` when
 * `folder` itself cannot be listed.
 */
export function discoverTranscripts(folder: string): TranscriptDiscovery {
  let entries: Dirent[];
  try {
    entries = sortedEntries(folder);
  } catch (error) {
    throw new TranscriptFolderError(unreadableCode(error));
  }
  const files: TranscriptFile[] = [];
  const diagnostics: TokenDiagnostic[] = [];
  const read = (path: string, label: string): string | null => {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      diagnostics.push({
        severity: "warning",
        code: "tokens-transcript-unreadable",
        message: `The transcript cannot be read (${unreadableCode(error)}); it is not measured.`,
        source: label,
      });
      return null;
    }
  };

  files.push(...sessionsOf(folder, entries, "", read));

  const parent = dirname(folder);
  const prefix = `${basename(folder)}${WORKTREE_INFIX}`;
  const isSpecWorktree = (name: string): boolean => name.startsWith(basename(folder)) && SPEC_WORKTREE_SUFFIX.test(name.slice(basename(folder).length));
  let siblings: Dirent[] = [];
  try {
    siblings = sortedEntries(parent);
  } catch (error) {
    diagnostics.push({
      severity: "warning",
      code: "tokens-worktrees-unreadable",
      message: `The folder holding the agent worktrees' transcripts cannot be listed (${unreadableCode(error)}); they are not measured.`,
    });
  }
  for (const sibling of siblings) {
    if (!sibling.isDirectory()) continue;
    const specWorktree = isSpecWorktree(sibling.name);
    if (!specWorktree && (!sibling.name.startsWith(prefix) || !WORKTREE_ID.test(sibling.name.slice(prefix.length)))) continue;
    const dir = join(parent, sibling.name);
    let inner: Dirent[];
    try {
      inner = sortedEntries(dir);
    } catch (error) {
      diagnostics.push({
        severity: "warning",
        code: "tokens-transcript-unreadable",
        message: `The worktree's transcript folder cannot be listed (${unreadableCode(error)}); it is not measured.`,
        source: `../${sibling.name}`,
      });
      continue;
    }
    if (specWorktree) {
      files.push(...sessionsOf(dir, inner, `../${sibling.name}/`, read));
      continue;
    }
    for (const entry of inner) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const label = `../${sibling.name}/${entry.name}`;
      const text = read(join(dir, entry.name), label);
      if (text !== null) files.push({ role: "worktree", session: entry.name.slice(0, -".jsonl".length), label, text });
    }
  }
  return { files, diagnostics };
}

/**
 * The main sessions of one project folder (the repository's own or a spec worktree's) and their sub-agents, from its
 * entries in byte order; `prefix` goes before every label (`""` for the folder itself, `../<sibling>/` otherwise).
 */
function sessionsOf(folder: string, entries: readonly Dirent[], prefix: string, read: (path: string, label: string) => string | null): TranscriptFile[] {
  const files: TranscriptFile[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      const label = `${prefix}${entry.name}`;
      const text = read(join(folder, entry.name), label);
      if (text !== null) files.push({ role: "main", session: entry.name.slice(0, -".jsonl".length), label, text });
    } else if (entry.isDirectory()) {
      files.push(...subagentsOf(folder, entry.name, prefix, read));
    }
  }
  return files;
}

/** The sub-agent transcripts of the session `session`, each with the `toolUseId` of its meta file or null. */
function subagentsOf(folder: string, session: string, prefix: string, read: (path: string, label: string) => string | null): TranscriptFile[] {
  const dir = join(folder, session, "subagents");
  let entries: Dirent[];
  try {
    entries = sortedEntries(dir);
  } catch {
    return []; // a session folder without sub-agents
  }
  const files: TranscriptFile[] = [];
  for (const entry of entries) {
    const match = SUBAGENT_FILE.exec(entry.name);
    if (!entry.isFile() || match === null) continue;
    const label = `${prefix}${session}/subagents/${entry.name}`;
    const text = read(join(dir, entry.name), label);
    if (text !== null) files.push({ role: "subagent", session, label, text, toolUseId: toolUseIdOf(join(dir, `${match[1] ?? ""}.meta.json`)) });
  }
  return files;
}

/** The `toolUseId` a sub-agent's `.meta.json` names; null when the file is missing, not JSON or carries none. */
function toolUseIdOf(path: string): string | null {
  try {
    const meta: unknown = JSON.parse(readFileSync(path, "utf8"));
    const id = typeof meta === "object" && meta !== null ? (meta as { toolUseId?: unknown }).toolUseId : undefined;
    return typeof id === "string" && id !== "" ? id : null;
  } catch {
    return null;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function printDiagnostics(diagnostics: readonly TokenDiagnostic[]): void {
  for (const d of diagnostics) {
    const where = [d.source, d.line === undefined ? undefined : `line ${d.line}`].filter((part) => part !== undefined).join(" ");
    console.error(`spectant: tokens: ${d.severity}${where === "" ? "" : ` ${where}`}: ${d.code}: ${d.message}`);
  }
}

/** The four counters over every request once: the invocation lines and the unassigned line partition the requests. */
function totalsOf(rows: readonly TokenRow[]): TokenCounters & { requests: number } {
  const totals = { requests: 0, input: 0, output: 0, cache_read: 0, cache_write: 0 };
  for (const row of rows) {
    if (row.kind !== "invocation" && row.kind !== "unassigned") continue;
    totals.requests += row.requests;
    for (const counter of TOKEN_COUNTERS) totals[counter] += row[counter];
  }
  return totals;
}

export interface TokensCommandOptions {
  /** `--transcripts DIR`, resolved; null derives the folder from the root. */
  readonly transcripts: string | null;
  readonly yes: boolean;
  /** The environment `CLAUDE_CONFIG_DIR` is read from. */
  readonly env: Env;
  /** The home directory `~/.claude` resolves against; defaults to the process's. */
  readonly home?: string;
}

/** `spectant tokens`: measures, prints the plan or what was written; 0 on success and on a dry run, 1 on a failure. */
export async function tokensCommand(root: string, options: TokensCommandOptions): Promise<number> {
  if (!isDirectory(join(root, "specs"))) {
    console.error(`spectant: tokens: ${basename(root)} has no specs/ folder; nothing to measure against`);
    return 1;
  }
  const folder = options.transcripts ?? defaultTranscriptFolder(realpathSync(root), options.env, options.home);
  const shown = options.transcripts === null ? `projects/${basename(folder)} in the Claude Code config directory` : basename(folder);
  let discovery: TranscriptDiscovery;
  try {
    discovery = discoverTranscripts(folder);
  } catch (error) {
    if (!(error instanceof TranscriptFolderError)) throw error;
    console.error(`spectant: tokens: the transcript folder ${shown} cannot be read (${error.code})`);
    return 1;
  }
  const reading = await readWorkspaceInput(root, null);
  if (!reading.readable) {
    console.error(`spectant: tokens: the workspace cannot be read (${reading.error})`);
    return 1;
  }
  const { input } = reading;
  const stages = new Map(buildDashboard({ ...input, services: [] }).specs.map((row) => [row.slug, row.stage]));
  const specs: TokenSpecInput[] = [...input.specs, ...input.archived]
    .map((files) => ({
      slug: files.folder,
      events: files.texts.events ?? null,
      rounds: files.texts.rounds ?? null,
      derivedStage: stages.get(files.folder) ?? null,
    }))
    .sort((a, b) => byteOrder(a.slug, b.slug));
  const path = join(root, TOKENS_PATH);

  let rows: TokenRow[];
  const diagnostics: TokenDiagnostic[] = [...discovery.diagnostics];
  try {
    const existing = readIfExists(path);
    const previous = existing === null ? { rows: [], diagnostics: [] } : readTokens(existing);
    const measured = tokenRows({ transcripts: discovery.files, specs });
    const baselines = mergeBaselines(
      previous.rows.filter((row): row is BaselineRow => row.kind === "baseline"),
      measured.baseline,
    );
    rows = [...baselines, ...measured.rows];
    diagnostics.push(...previous.diagnostics, ...measured.diagnostics);
  } catch (error) {
    printDiagnostics(diagnostics);
    console.error(`spectant: tokens: ${reason(error)}`);
    return 1;
  }
  printDiagnostics(diagnostics);

  let text: string;
  try {
    text = serializeTokens(rows);
    if (options.yes) writeInPlace(path, text);
  } catch (error) {
    console.error(`spectant: tokens: ${reason(error)}`);
    return 1;
  }

  const counts = new Map<TokenRowKind, number>(TOKEN_ROW_KINDS.map((kind) => [kind, 0]));
  for (const row of rows) counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);
  const totals = totalsOf(rows);
  console.log(`tokens ${options.yes ? "wrote" : "would write"} ${TOKENS_PATH} (${rows.length} lines, ${discovery.files.length} transcripts):`);
  console.log(`  lines: ${TOKEN_ROW_KINDS.map((kind) => `${kind} ${counts.get(kind) ?? 0}`).join(", ")}`);
  console.log(`  totals: requests ${totals.requests}, ${TOKEN_COUNTERS.map((counter) => `${counter} ${totals[counter]}`).join(", ")}`);
  if (!options.yes) console.log("run it again with --yes to write");
  return 0;
}
