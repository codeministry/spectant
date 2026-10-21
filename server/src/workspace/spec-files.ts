/**
 * The texts of one spec folder and of the story folder, as the workspace reading takes them: every text file kind of a
 * spec folder (folders as `listSpecs` finds them), the story folder `specs/ideas/` (every `*.md` directly in it,
 * `README.md` the index, as `core/`'s `readIdeas` takes it, T79), and the three gate hashes over a folder's texts. It
 * parses nothing: every parse is `core/`'s (ISC-5, `bun run check:single-core`).
 *
 * Read-only (ISC-15): `infra/fs/read.ts` reads, no write, no temp file, no lock.
 */
import { join } from "node:path";
import { FILE_KINDS, repoFilePath } from "../../../core/src/files.ts";
import type { IdeaFiles, SpecFiles, TextFileKind } from "../../../core/src/files.ts";
import { hashForGate } from "../../../core/src/gates.ts";
import type { SpecRef } from "../../../core/src/resolve.ts";
import type { ReviewedHashes } from "../contracts/spec-routes.contract.ts";
import { readIfExists, readMarkdownFiles } from "../infra/fs/read.ts";

/** The kinds that live inside a spec folder; master and constitution are read once per workspace. */
export const FOLDER_KINDS = (Object.keys(FILE_KINDS) as Array<keyof typeof FILE_KINDS>).filter(
  (kind): kind is TextFileKind => !FILE_KINDS[kind].directory && !FILE_KINDS[kind].path.startsWith(".."),
);

/**
 * The story folder `specs/ideas/` of the workspace at `root` as `readIdeas` takes it: every regular `*.md` file directly
 * in it, file name to text (`README.md` included, the index). A missing folder is an empty record; any other read
 * failure propagates. Which names are stories is `readIdeas`'s decision, not this one's.
 */
export function readIdeaFiles(root: string): IdeaFiles {
  return readMarkdownFiles(repoFilePath(root, "idea"));
}

export function specFiles(dir: string, folder: string): SpecFiles {
  const texts: Partial<Record<TextFileKind, string>> = {};
  for (const kind of FOLDER_KINDS) {
    const text = readIfExists(join(dir, FILE_KINDS[kind].path));
    if (text !== null) texts[kind] = text;
  }
  return { folder, texts };
}

// ── one spec folder (spec routes, T45) ─────────────────────────────────────────────────────────────

/**
 * The texts of one spec folder, as `readWorkspaceInput` reads each folder: `folder` is the folder name (`NNN-slug`),
 * the constitution and the master are not included. A missing file is an absent key; any other read failure throws,
 * and `unreadableCode` turns it into the workspace's code.
 */
export function readSpecFiles(ref: Pick<SpecRef, "dir" | "slug">): SpecFiles {
  return specFiles(ref.dir, ref.slug);
}

/** The three gate hashes of a spec folder's texts (`hashForGate`); null for a file that does not exist. */
export function gateHashes(texts: SpecFiles["texts"]): ReviewedHashes {
  const hash = (file: "spec.md" | "plan.md" | "tasks.md", text: string | undefined): string | null => (text === undefined ? null : hashForGate(file, text));
  return { spec: hash("spec.md", texts.spec), plan: hash("plan.md", texts.plan), tasks: hash("tasks.md", texts.tasks) };
}
