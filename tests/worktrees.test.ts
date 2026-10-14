// The end of a spec's worktree on its timeline (spec 027, T25, ISC-175.1): `GET /api/workspaces/:ws/specs/:id/timeline`
// through the real spec routes, over the git fixture of `tests/fixtures/worktree-repo.ts`.
//
// The contract under test (server/src/workspace-loader.ts `timelineWorktreeOf`, core/src/timeline.ts): a spec branch
// merged into `main` is one derived `worktree` entry `merged`, dated by the merge commit; a spec branch, unmerged, that
// no live worktree carries is one undated entry `removed`, naming the worktree's path while git still lists it; an open
// branch with its worktree, or one checked out in the main checkout, gives none. Merged or removed, the worktree leaves
// the dashboard reading, so no chip shows. Nothing is written: `events.jsonl` stays byte-identical.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { TimelineEntry } from "../core/src/files.ts";
import type { ApiHandler } from "../server/src/http.ts";
import { LIFEOS_ABSENT } from "../server/src/lifeos.ts";
import { type Registry, openRegistry } from "../server/src/registry.ts";
import { specRoutes } from "../server/src/spec-routes.contract.ts";
import { specRoutesApi } from "../server/src/spec-routes.ts";
import { readWorkspaceInput } from "../server/src/workspace-loader.ts";
import {
  DATES,
  type PlantedWorktreeRepo,
  SPEC_BRANCH,
  SPEC_FOLDER,
  SPEC_ID,
  SPEC_WORKTREE,
  type WorktreeRepoOptions,
  plantWorktreeRepo,
} from "./fixtures/worktree-repo.ts";

const HOST = { Host: "127.0.0.1:7717" };
const bases: string[] = [];
const registries: Registry[] = [];

afterAll(() => {
  for (const registry of registries.splice(0)) registry.close();
  for (const base of bases.splice(0)) rmSync(base, { recursive: true, force: true });
});

async function plant(options: WorktreeRepoOptions = {}): Promise<PlantedWorktreeRepo> {
  const repo = await plantWorktreeRepo(options);
  bases.push(repo.base);
  return repo;
}

/** The spec routes for the fixture's main checkout, registered alone; the workspace slug is the folder's name. */
function handlerFor(repo: PlantedWorktreeRepo): ApiHandler {
  const registry = openRegistry(mkdtempSync(join(repo.base, "data-")));
  registries.push(registry);
  registry.add(repo.root);
  return specRoutesApi({ registry, lifeos: LIFEOS_ABSENT });
}

/** The spec's timeline entries of kind `worktree`, and the bytes of its events.jsonl before and after the read. */
async function worktreeEntries(repo: PlantedWorktreeRepo): Promise<{ entries: TimelineEntry[]; eventsBefore: Buffer; eventsAfter: Buffer }> {
  const events = join(repo.root, "specs", SPEC_FOLDER, "events.jsonl");
  const eventsBefore = readFileSync(events);
  const path = specRoutes.timeline("harbor", SPEC_ID);
  const url = new URL(`http://127.0.0.1:7717${path}`);
  const res = await handlerFor(repo)(new Request(url.href, { headers: HOST }), url);
  if (res === null) throw new Error(`the spec routes declined ${path}`);
  expect(res.status).toBe(200);
  const entries = ((await res.json()) as TimelineEntry[]).filter((e) => e.kind === "worktree");
  return { entries, eventsBefore, eventsAfter: readFileSync(events) };
}

/** The spec worktrees the dashboard reading hands to `core/` for spec 002: what its chip is made of. */
async function chipWorktrees(repo: PlantedWorktreeRepo): Promise<string[]> {
  const reading = await readWorkspaceInput(repo.root);
  if (!reading.readable) throw new Error("the fixture workspace is unreadable");
  return (reading.input.worktrees?.worktrees ?? []).filter((w) => w.kind === "spec" && w.spec === SPEC_ID).map((w) => w.path);
}

describe("ISC-175.1 merged: the timeline derives the end of a spec's worktree from git, the chip goes, nothing is written", () => {
  test("merged: branch merged into main → one derived entry at the merge commit's date, chip gone, events.jsonl byte-identical", async () => {
    const repo = await plant({ merged: true });
    const { entries, eventsBefore, eventsAfter } = await worktreeEntries(repo);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry?.derived).toBe(true);
    expect(entry?.ref).toBe("merged");
    expect(Date.parse(entry?.ts ?? "")).toBe(Date.parse(DATES.merge));
    expect(entry?.worktree).toEqual({ state: "merged", branch: SPEC_BRANCH, path: SPEC_WORKTREE, commit: repo.commits.merge?.slice(0, 7) ?? null });
    expect(await chipWorktrees(repo)).toEqual([]);
    expect(eventsAfter.equals(eventsBefore)).toBe(true);
  });

  test("merged: merged and the worktree removed → still the merged entry, the merge wins", async () => {
    const repo = await plant({ merged: true, removeWorktree: true });
    const { entries } = await worktreeEntries(repo);
    expect(entries.map((e) => e.worktree?.state)).toEqual(["merged"]);
    expect(entries[0]?.worktree?.path).toBeNull();
    expect(await chipWorktrees(repo)).toEqual([]);
  });

  test("merged: worktree removed, branch open → one undated derived entry `removed`, chip gone, events.jsonl byte-identical", async () => {
    const repo = await plant({ removeWorktree: true });
    const { entries, eventsBefore, eventsAfter } = await worktreeEntries(repo);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry?.derived).toBe(true);
    expect(entry?.undated).toBe(true);
    expect(entry?.ref).toBe("removed");
    expect(entry?.worktree).toEqual({ state: "removed", branch: SPEC_BRANCH, path: null, commit: null });
    expect(await chipWorktrees(repo)).toEqual([]);
    expect(eventsAfter.equals(eventsBefore)).toBe(true);
  });

  test("merged: worktree folder deleted while git still lists it (prunable) → `removed` naming its path, chip gone", async () => {
    const repo = await plant();
    rmSync(repo.worktrees.spec, { recursive: true, force: true });
    const { entries } = await worktreeEntries(repo);
    expect(entries.map((e) => e.worktree)).toEqual([{ state: "removed", branch: SPEC_BRANCH, path: SPEC_WORKTREE, commit: null }]);
    expect(await chipWorktrees(repo)).toEqual([]);
  });

  test("merged: branch open with its worktree → no entry, the chip stays, events.jsonl byte-identical", async () => {
    const repo = await plant();
    const { entries, eventsBefore, eventsAfter } = await worktreeEntries(repo);
    expect(entries).toEqual([]);
    expect(await chipWorktrees(repo)).toEqual([SPEC_WORKTREE]);
    expect(eventsAfter.equals(eventsBefore)).toBe(true);
  });

  test("merged: worktree removed, the branch checked out in the main checkout → no entry, it is worked on there", async () => {
    const repo = await plant({ removeWorktree: true });
    expect((await repo.git(repo.root, "switch", "-q", SPEC_BRANCH)).code).toBe(0);
    const { entries } = await worktreeEntries(repo);
    expect(entries).toEqual([]);
  });

  test("merged: a spec without a branch → no entry", async () => {
    const repo = await plant({ removeWorktree: true });
    expect((await repo.git(repo.root, "branch", "-D", SPEC_BRANCH)).code).toBe(0);
    const { entries } = await worktreeEntries(repo);
    expect(entries).toEqual([]);
  });
});
