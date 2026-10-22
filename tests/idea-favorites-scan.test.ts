// The idea favourites' share of the workspace scan (spec 064 T52, ISC-496): when the story `specs/ideas/<slug>.md` of
// an `idea_favorite` row is gone and the workspace has an open spec `NNN-<slug>` with the same slug (allocated in the
// app or through `/spec new`), the scan stars that spec and drops the idea; without such a spec, the idea favourite
// lapses. A story that is still there keeps its star. As for spec favourites (spec 057, ISC-353), only the scan before
// a live build writes, never a GET handler.
import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dashboardApi } from "../server/src/cli/index.ts";
import { SPEC_API_ROOT, workspaceRoutes } from "../server/src/contracts/spec-routes.contract.ts";
import { addFavorite, addIdeaFavorite, listFavorites, listIdeaFavorites, openDatabase } from "../server/src/infra/db/db.ts";
import { type Registry, openRegistry } from "../server/src/infra/db/registry.ts";
import { favoritesScan } from "../server/src/planning/index.ts";

const NOW = "2026-10-22T10:00:00.000Z";
const HOST = { Host: "127.0.0.1:7717" };

let root: string;
let repo: string;
let ws: string;
let db: Database;
let registry: Registry;

/** Writes `specs/<folder>/spec.md`; `folder` may lie under `archive/`. */
function specFolder(folder: string): void {
  mkdirSync(join(repo, "specs", folder), { recursive: true });
  writeFileSync(join(repo, "specs", folder, "spec.md"), `# ${folder}\n`);
}

const storyPath = (slug: string): string => join(repo, "specs", "ideas", `${slug}.md`);

/** Writes the story `specs/ideas/<slug>.md` and stars it as an idea favourite. */
function starredStory(slug: string): void {
  writeFileSync(storyPath(slug), `# ${slug}\n`);
  addIdeaFavorite(db, ws, slug, NOW);
}

/** One scan of the workspace, as the live stream runs it before a build. */
const scan = (): Promise<void> => favoritesScan({ db, registry })({ ws });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "spectant-idea-favorites-"));
  repo = join(root, "repo");
  mkdirSync(join(repo, "specs", "ideas"), { recursive: true });
  mkdirSync(join(repo, "specs", "archive"));
  specFolder("001-alpha");
  db = openDatabase(join(root, "data"));
  registry = openRegistry(join(root, "data"));
  ws = registry.add(repo).slug;
});

afterEach(() => {
  registry.close();
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe("idea favourites at the workspace scan (spec 064 T52, ISC-496)", () => {
  test("allocation: the story is gone and the open spec 010-<slug> is there, so the spec is starred and the idea is not", async () => {
    starredStory("night-mode");
    rmSync(storyPath("night-mode"));
    specFolder("010-night-mode");
    await scan();
    expect(listFavorites(db, ws)).toEqual(["010-night-mode"]);
    expect(listIdeaFavorites(db, ws)).toEqual([]);
  });

  test("a spec already starred keeps its one star, and a second scan changes nothing", async () => {
    starredStory("night-mode");
    specFolder("010-night-mode");
    addFavorite(db, ws, "010-night-mode", NOW);
    rmSync(storyPath("night-mode"));
    await scan();
    await scan();
    expect(listFavorites(db, ws)).toEqual(["010-night-mode"]);
    expect(listIdeaFavorites(db, ws)).toEqual([]);
  });

  test("deletion: the story is gone and no spec has its slug, so the idea favourite lapses and no spec is starred", async () => {
    starredStory("night-mode");
    starredStory("dark-mode");
    rmSync(storyPath("night-mode"));
    specFolder("011-night-modes");
    await scan();
    expect(listIdeaFavorites(db, ws)).toEqual(["dark-mode"]);
    expect(listFavorites(db, ws)).toEqual([]);
  });

  test("a story that still exists keeps its favourite, even beside a spec with the same slug", async () => {
    starredStory("night-mode");
    specFolder("010-night-mode");
    await scan();
    expect(listIdeaFavorites(db, ws)).toEqual(["night-mode"]);
    expect(listFavorites(db, ws)).toEqual([]);
  });

  test("an archived spec with the slug is no target: the idea favourite goes, no spec is starred", async () => {
    starredStory("night-mode");
    rmSync(storyPath("night-mode"));
    specFolder("archive/010-night-mode");
    await scan();
    expect(listIdeaFavorites(db, ws)).toEqual([]);
    expect(listFavorites(db, ws)).toEqual([]);
  });

  test("a scan that cannot list specs/ (mid-checkout, unmounted) keeps every idea favourite", async () => {
    starredStory("night-mode");
    renameSync(join(repo, "specs"), join(repo, "specs-away"));
    await scan();
    expect(listIdeaFavorites(db, ws)).toEqual(["night-mode"]);
  });

  test("no write on get: favourites, dashboard, planning and story reads leave both favourite tables byte-identical", async () => {
    starredStory("night-mode");
    starredStory("dark-mode");
    rmSync(storyPath("night-mode"));
    specFolder("010-night-mode");
    const tables = (): string =>
      JSON.stringify([
        db.query("SELECT * FROM idea_favorite ORDER BY ws, slug").all(),
        db.query("SELECT * FROM spec_favorite ORDER BY ws, spec").all(),
      ]);
    const before = tables();
    const api = dashboardApi({ registry, db, services: () => Promise.resolve([]) });
    const paths = [
      workspaceRoutes.favorites(ws),
      SPEC_API_ROOT,
      `${SPEC_API_ROOT}/${encodeURIComponent(ws)}/dashboard`,
      workspaceRoutes.planning(ws),
      workspaceRoutes.idea(ws, "dark-mode"),
      workspaceRoutes.idea(ws, "night-mode"),
    ];
    const statuses: number[] = [];
    for (const path of paths) {
      const url = new URL(path, "http://127.0.0.1:7717");
      const res = await api(new Request(url.href, { headers: HOST }), url);
      statuses.push(res?.status ?? 0);
      await res?.arrayBuffer();
    }
    // A story page needs its index row to answer 200; here it only has to read and never write.
    expect(statuses.slice(0, 4)).toEqual([200, 200, 200, 200]);
    expect(statuses.slice(4).every((status) => status === 200 || status === 404)).toBe(true);
    expect(tables()).toBe(before);
    await scan();
    expect(listFavorites(db, ws)).toEqual(["010-night-mode"]);
    expect(listIdeaFavorites(db, ws)).toEqual(["dark-mode"]);
  });
});
