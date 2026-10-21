/**
 * The allocation of a story (spec 008, T86, ISC-130.2): `writeAllocate` over `runWrite` (`run-write.ts`). It creates
 * `specs/NNN-slug/` (its one directory), writes three files there and removes the story file; it always targets the
 * repository `root`.
 */
import { abortAge } from "../infra/abort-age.ts";
import { join } from "node:path";
import { allocationOf, nextSpecNumber, specNumbersOf } from "../../../core/src/allocate.ts";
import { type SpecFiles, repoFilePath } from "../../../core/src/files.ts";
import { readIdeas } from "../../../core/src/ideas.ts";
import { listSpecs } from "../../../core/src/resolve.ts";
import type { AllocateRequest } from "../contracts/spec-routes.contract.ts";
import { CONTEXT_PATH, EVENTS_PATH, SPEC_PATH, eventAppendBytes, ideaConflict, writeActorOf, writePathsOf } from "../contracts/writes.contract.ts";
import { createDir, fsyncDir, pathTaken, removeFile, writeInPlace } from "../infra/fs/in-place.ts";
import { readBytesIfExists } from "../infra/fs/read.ts";
import { takenSpecNumbers } from "../infra/git/index.ts";
import { rawSha256 } from "../infra/hash.ts";
import { readIdeaFiles, viewerActorOf } from "../workspace/index.ts";
import { type WriteResult, runWrite } from "./run-write.ts";

export interface AllocateWriteInput {
  /** The repository root. */
  readonly root: string;
  /** The story's slug: its file name in `specs/ideas/` without `.md`, as the request path names it. */
  readonly slug: string;
  readonly stateDir: string | null;
  readonly now: Date;
  readonly body: AllocateRequest;
  /** The run lock's abort age (`WriteInput.abortAfterMs`). */
  readonly abortAfterMs?: number;
}

/**
 * Starting a story (T86, ISC-130.2; FORMAT.md § idea, Allocation). Before the write's one await: the viewer's actor
 * (`writeActorOf`, `VIEWER_ACTOR_FALLBACK` without a git address) and the numbers branch names and history have given
 * out (`takenSpecNumbers`, none without a repository). Then under `runWrite`, synchronously:
 *
 * 1. the story must be one `readIdeas` lists (404 otherwise: no path is built from the request alone); its file's raw
 *    sha256 against the client's `IdeaPage.hash` (409 `StaleIdea` with the path and the hash now, nothing written);
 * 2. the number is `nextSpecNumber` over the `NNN-slug` folders of `specs/` and `specs/archive/` (`listSpecs`) and the
 *    numbers from git; `allocationOf` plans the folder, `spec.md`, `context.md` and the creation event by the viewer;
 * 3. 422 `allocate-refused`: `not-in-index` when the index (`specs/ideas/README.md`) does not name the story (its
 *    `ideas-index` finding), `folder-exists` when anything already has the folder's name (a file or a link is no spec
 *    folder, so it took no number; a folder would have). Nothing is written;
 * 4. on yes: `specs/NNN-slug/` created (that one directory), `context.md`, `spec.md` and `events.jsonl` written in place
 *    with an fsync, the story file removed, both directories fsynced. Nothing else: no README edit. The index row's
 *    `Spec` cell, which FORMAT.md names as the mark of a started story, is the web's or the skill's to fill; until then
 *    the index names a story without a file, which `readIdeas` reports as one `ideas-index` warning.
 *
 * No claim lock's 423: a story has no claims, so no session can hold a lock on it, and the new folder's claimless
 * `spec.md` gives `blockingLock` nothing to block on. The 423 it can answer is the run lock's (spec 040, ISC-225):
 * while a run on the story is `running` (`runTarget: {idea: slug}`), 423 `run-locked`, nothing written; an `aborted`
 * run locks nothing. `lockSource` still reports the source consulted. A number above 999 has no three-digit folder:
 * `allocationOf` throws, the route answers 500.
 */
export async function writeAllocate(input: AllocateWriteInput): Promise<WriteResult<"allocate">> {
  const { root, slug, now, body } = input;
  const actor = writeActorOf(await viewerActorOf(root));
  const taken = await takenSpecNumbers(root);
  return runWrite<"allocate">({
    root,
    stateDir: input.stateDir,
    now,
    runTarget: { idea: slug },
    ...abortAge(input.abortAfterMs),
    read: () => {
      const stories = readIdeaFiles(root);
      const listed = readIdeas(stories).ideas.find((ref) => ref.slug === slug);
      if (listed === undefined) return null;
      const name = `${slug}.md`;
      const storyPath = join(repoFilePath(root, "idea"), name);
      const bytes = readBytesIfExists(storyPath);
      if (bytes === null) return null;
      const stale = ideaConflict(listed.path, body.hash, rawSha256(bytes));
      if (stale !== null) return { stale };
      // The plan works on exactly the bytes just hashed; the index as read beside them.
      const text = bytes.toString("utf8");
      const reading = readIdeas({ ...stories, [name]: text });
      const idea = reading.ideas.find((ref) => ref.slug === slug);
      if (idea === undefined) return null;
      const number = nextSpecNumber([...specNumbersOf(listSpecs(root).map((ref) => ref.slug)), ...taken.numbers]);
      const plan = allocationOf(idea, text, number, now, actor);
      const paths = writePathsOf("allocate", plan.folder, slug);
      const folder = `specs/${plan.folder}/`;
      // A story has no claims and the new folder none yet: the lock check has nothing to block on (header).
      const files: SpecFiles = { folder: plan.folder, texts: {} };
      const unindexed = reading.diagnostics.some((d) => d.diagnostic.code === "ideas-index" && d.diagnostic.subject === slug);
      if (unindexed) return { files, claim: null, commit: { refused: { error: "allocate-refused", reason: "not-in-index", folder } } };
      const dir = join(root, "specs", plan.folder);
      if (pathTaken(dir)) return { files, claim: null, commit: { refused: { error: "allocate-refused", reason: "folder-exists", folder } } };
      return {
        files,
        claim: null,
        commit: (lockSource) => {
          createDir(dir);
          writeInPlace(join(dir, CONTEXT_PATH), plan.contextText);
          writeInPlace(join(dir, SPEC_PATH), plan.specText);
          writeInPlace(join(dir, EVENTS_PATH), eventAppendBytes(null, plan.event));
          fsyncDir(dir);
          removeFile(storyPath);
          fsyncDir(repoFilePath(root, "idea"));
          return { id: String(number).padStart(3, "0"), folder, files: paths.writes, removed: paths.removes[0] ?? idea.path, lockSource };
        },
      };
    },
  });
}
