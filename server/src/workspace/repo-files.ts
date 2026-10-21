/**
 * The repository files of one workspace from their read source (spec 039, ISC-209): `ISA.md`, the files directly in
 * `specs/` and the stories of `specs/ideas/`, each from the main checkout or from a live spec worktree whose branch holds
 * a newer version, as `core/`'s `repoFileSourceOf` decides on the git facts of the worktree view (`readWorktreeView`).
 * A worktree's file is read only as a regular file, never through a link. Nothing is written.
 */
import { join } from "node:path";
import type { FileDiagnostic, IdeaFiles, RepoFileSource } from "../../../core/src/files.ts";
import type { Diagnostic } from "../../../core/src/diagnostics.ts";
import { MAIN_SOURCE, REPO_SOURCE_PATHS, type RepoFileCandidate, repoFileSourceOf } from "../../../core/src/repo-source.ts";
import { rawSha256 } from "../infra/hash.ts";
import { mtimeIsoOf, readBytesIfExists, regularBytes } from "../infra/fs/read.ts";
import { readIdeaFiles } from "./spec-files.ts";
import { type CheckoutFacts, type WorktreeReading, readWorktreeView } from "./worktree-view.ts";

/** One repository file as read (`readRepoFile`): its text, where it was read, and the warnings its sources raise. */
export interface RepoFileReading {
  /** The text of the version read; null when that checkout has no such file. */
  readonly text: string | null;
  /** The absolute file the text came from; server-internal, never part of a response (ISC-3). */
  readonly absolute: string;
  readonly source: RepoFileSource;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * The repository file `path` (relative to the root, one of `REPO_SOURCE_PATHS`) from its read source (spec 039,
 * ISC-209): the server gathers, for the main checkout and each live spec worktree of a spec inside the repository,
 * whether the file is there, whether that branch tracks it, whether its bytes differ from the main checkout's, a digest
 * and its time (its mtime when `git status` lists it as changed there, else its last commit there), and `core/`'s
 * `repoFileSourceOf` decides. A worktree's file is read only as a regular file, never through a link. `reading` is the
 * caller's `readWorktreeView`, read anew when absent. Nothing is written.
 */
export async function readRepoFile(root: string, path: string, reading?: WorktreeReading): Promise<RepoFileReading> {
  const { repoFacts } = reading ?? (await readWorktreeView(root));
  const mainAbsolute = join(root, ...path.split("/"));
  // The main checkout read as before spec 039: a failure other than a missing file propagates.
  const mainBytes = readBytesIfExists(mainAbsolute);
  const mainText = mainBytes === null ? null : mainBytes.toString("utf8");
  const digestOf = (bytes: Buffer | null): string | null => (bytes === null ? null : rawSha256(bytes));
  const timeOf = (absolute: string, facts: CheckoutFacts): string | null => {
    if (facts.changed.includes(path)) return mtimeIsoOf(absolute);
    return facts.lastCommit[path] ?? null;
  };
  const candidates: RepoFileCandidate[] = [
    { origin: MAIN_SOURCE, present: mainBytes !== null, tracked: repoFacts.main.tracked.includes(path), differs: false, digest: digestOf(mainBytes), at: mainBytes === null ? null : timeOf(mainAbsolute, repoFacts.main) },
  ];
  const texts = new Map<string, { text: string; absolute: string }>();
  for (const { path: worktree, facts } of repoFacts.worktrees) {
    const absolute = join(root, worktree, ...path.split("/"));
    // Only a version its branch tracks can compete; an untracked one is not even read.
    const bytes = facts.tracked.includes(path) ? regularBytes(absolute) : null;
    if (bytes !== null) texts.set(worktree, { text: bytes.toString("utf8"), absolute });
    candidates.push({
      origin: { kind: "worktree", worktree },
      present: bytes !== null,
      tracked: facts.tracked.includes(path),
      differs: bytes !== null && (mainBytes === null || !bytes.equals(mainBytes)),
      digest: digestOf(bytes),
      at: bytes === null ? null : timeOf(absolute, facts),
    });
  }
  const decision = repoFileSourceOf(path, candidates);
  const chosen = decision.source.kind === "worktree" ? texts.get(decision.source.worktree) : undefined;
  return chosen === undefined
    ? { text: mainText, absolute: mainAbsolute, source: MAIN_SOURCE, diagnostics: decision.diagnostics }
    : { text: chosen.text, absolute: chosen.absolute, source: decision.source, diagnostics: decision.diagnostics };
}

/** The story folder from the read sources of its files (`readIdeaSources`): the files, and each story's source. */
export interface IdeaSources {
  readonly files: IdeaFiles;
  /** Per file name, the worktree source of a story read from a spec worktree; absent for one read from main. */
  readonly sources: Readonly<Record<string, RepoFileSource>>;
  /** Each story as `readRepoFile` read it, for its findings; empty without a spec worktree. */
  readonly reads: readonly RepoFileReading[];
}

/**
 * `specs/ideas/` from the read sources of its files (spec 039, ISC-209): the `*.md` files directly in the main
 * checkout's folder and those a live spec worktree's branch tracks there, each read by `readRepoFile`, so a story
 * changed or added in a worktree shows that version. Without a worktree, exactly `readIdeaFiles`.
 */
export async function readIdeaSources(root: string, reading?: WorktreeReading): Promise<IdeaSources> {
  const view = reading ?? (await readWorktreeView(root));
  const main = readIdeaFiles(root);
  const ideasDir = REPO_SOURCE_PATHS.find((p) => p.endsWith("/")) ?? "specs/ideas/";
  const names = new Set(Object.keys(main));
  for (const { facts } of view.repoFacts.worktrees) {
    for (const path of facts.tracked) {
      const name = path.startsWith(ideasDir) ? path.slice(ideasDir.length) : "";
      if (name.endsWith(".md") && !name.includes("/")) names.add(name);
    }
  }
  if (view.repoFacts.worktrees.length === 0) return { files: main, sources: {}, reads: [] };
  const files: Record<string, string> = {};
  const sources: Record<string, RepoFileSource> = {};
  const reads: RepoFileReading[] = [];
  for (const name of [...names].sort()) {
    const read = await readRepoFile(root, `${ideasDir}${name}`, view);
    reads.push(read);
    if (read.text === null) continue;
    files[name] = read.text;
    if (read.source.kind === "worktree") sources[name] = read.source;
  }
  return { files, sources, reads };
}

/** The findings of repository file reads as workspace diagnostics, each file's conflict once (ISC-209.1). */
export function sourceFindings(reads: readonly RepoFileReading[]): FileDiagnostic[] {
  const seen = new Set<string>();
  const out: FileDiagnostic[] = [];
  for (const read of reads) {
    for (const diagnostic of read.diagnostics) {
      const file = diagnostic.subject ?? "";
      const key = `${diagnostic.code}\0${file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ file, diagnostic });
    }
  }
  return out;
}
