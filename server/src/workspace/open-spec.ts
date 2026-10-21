/**
 * The prelude of every request on one spec (spec 059, T38): the workspace must be readable, the spec resolved by
 * `resolveWorkspaceSpec` (core's `resolveSpec`, then the specs only a spec worktree carries, spec 039 ISC-208.1; the id
 * `NNN`, the folder name or the bare slug), and then, on `open`, the spec's files from its read source and the
 * workspace's constitution. The spec routes answer every read and every write on a spec from it, so the reads and the
 * writes share one prelude without importing each other.
 */
import type { SpecFiles } from "../../../core/src/files.ts";
import type { SpecRef } from "../../../core/src/resolve.ts";
import type { UnreadableCode } from "../contracts/spec-routes.contract.ts";
import { workspaceUnreadable } from "../infra/fs/errno.ts";
import { readRepoFile } from "./repo-files.ts";
import { readSpecSource, resolveWorkspaceSpec } from "./spec-source.ts";
import { type WorktreeReading, readWorktreeView } from "./worktree-view.ts";

/** One spec read from its read source, with what every route on it needs beside its files. */
export interface OpenedSpec {
  /** The workspace's worktree view, read once for the spec's source and every later read of the request. */
  readonly reading: WorktreeReading;
  /** The spec's files from its read source. */
  readonly files: SpecFiles;
  /** The folder the copy kinds were read from: the worktree copy's, or the main checkout's `ref.dir`. */
  readonly dir: string;
  /** The spec with `dir` as its folder: what the three writes on the spec read, compare and write. */
  readonly source: SpecRef;
  /** The constitution from its read source (spec 039, ISC-209), read on each call. */
  readonly constitution: () => Promise<string | null>;
}

/**
 * The spec a request names: `unreadable` with the workspace's code, `not-found` when no spec or an ambiguous one
 * matches, else the spec, whose read source `open` reads (null when its folder has no `spec.md`, no spec either).
 */
export type SpecOpening =
  | { readonly kind: "unreadable"; readonly code: UnreadableCode }
  | { readonly kind: "not-found" }
  | { readonly kind: "spec"; readonly ref: SpecRef; readonly open: () => Promise<OpenedSpec | null> };

export async function openSpec(root: string, id: string): Promise<SpecOpening> {
  const unreadable = workspaceUnreadable(root);
  if (unreadable !== null) return { kind: "unreadable", code: unreadable };
  const ref = await resolveWorkspaceSpec(root, id);
  if (ref.kind !== "spec") return { kind: "not-found" };
  return {
    kind: "spec",
    ref,
    open: async () => {
      // The spec's read source, as the row and the head read it (spec 027, ISC-181): `dir` is the worktree copy's folder
      // when the source is `worktree`, for every file of the folder, the evidence file route's `artifacts/`, `.evidence/`
      // and `.design/` included (spec 039, ISC-208). The three writes on the spec (reviewed mark, tick, stage move) take
      // `source`: they read, compare and write the copy the client's hashes came from (T22), so a source that switched
      // between render and write is the plain 409 of the hash compare.
      const reading = await readWorktreeView(root);
      const { files, dir } = await readSpecSource(root, ref, reading);
      if (files.texts.spec === undefined) return null;
      const source = { ...ref, dir };
      // The constitution and the workflow from their read source (spec 039, ISC-209), as the dashboard reading reads them.
      const constitution = async (): Promise<string | null> => (await readRepoFile(root, "specs/constitution.md", reading)).text;
      return { reading, files, dir, source, constitution };
    },
  };
}
