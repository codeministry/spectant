/**
 * The token baseline's measuring run (spec 009, T7, ISC-135): `spectant tokens [--root DIR] [--transcripts DIR] [--yes]`.
 *
 * 1. The root must hold a `specs/` folder (exit 1 otherwise; nothing is created).
 * 2. The transcripts come from `discoverTranscripts` (`transcripts.ts`, which names the folders it reads).
 * 3. The repository side comes from the workspace loader (`readWorkspaceInput`): each spec folder's `events.jsonl` and
 *    `rounds.jsonl` texts and its derived stage from core's dashboard model, plus an existing `specs/tokens.jsonl`.
 * 4. Everything is measured in core (`core/src/tokens.ts`): the existing file read back (`readTokens`), the run
 *    (`tokenRows`), the baseline lines merged (`mergeBaselines`) and the file text serialised (`serializeTokens`).
 *    Nothing of a transcript, an event or a round line is parsed here. A throw from core is one stderr line and exit 1.
 * 5. Diagnostics go to stderr and never change the exit code. Without `--yes` the command prints what it would write
 *    (path, line counts, totals) and exits 0; with `--yes` it writes `specs/tokens.jsonl` in place through
 *    `infra/fs/in-place.ts` (open, write, fsync, close; no temp file), creating the file when absent.
 *
 * It never opens the app's data directory, the database or the network.
 */
import { basename, join } from "node:path";
import { buildDashboard } from "../../../core/src/dashboard.ts";
import {
  type BaselineRow,
  TOKEN_COUNTERS,
  TOKEN_ROW_KINDS,
  type TokenCounters,
  type TokenDiagnostic,
  type TokenRow,
  type TokenRowKind,
  type TokenSpecInput,
  mergeBaselines,
  readTokens,
  serializeTokens,
  tokenRows,
} from "../../../core/src/tokens.ts";
import { WRITE_PATHS } from "../contracts/writes.contract.ts";
import { writeInPlace } from "../infra/fs/in-place.ts";
import { isDirectory, realPath } from "../infra/fs/list.ts";
import { readIfExists } from "../infra/fs/read.ts";
import { readWorkspaceInput } from "../workspace/index.ts";
import {
  type Env,
  TranscriptFolderError,
  type TranscriptDiscovery,
  byteOrder,
  defaultTranscriptFolder,
  discoverTranscripts,
} from "./transcripts.ts";

/** The repository-relative path of the measurement file: the one file of the sixth write path, `WRITE_PATHS.tokens`. */
export const TOKENS_PATH: string = WRITE_PATHS.tokens.writes[0];

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
  const folder = options.transcripts ?? defaultTranscriptFolder(realPath(root), options.env, options.home);
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
