/**
 * architecture — the folder-shape and import-graph rules of `scripts/check-architecture.ts` (spec 059).
 *
 * `-t layout` selects ISC-409, `-t imports` ISC-410, `-t "io rule"` ISC-411 (`-t io` also selects `isolation`). Each rule
 * runs on one fixture root per clause under
 * `tests/fixtures/architecture/`, with the server entry's own `layout` and `imports` sections, and must return exactly
 * the expected violations. The app case runs the rule on the real server entry of `scripts/architecture.config.ts`;
 * since the split (T61) it is a plain `test` and must stay clean.
 *
 * `-t layers` selects ISC-424 (spec 060): the web entry's layer order on one fixture root per forbidden direction and
 * a clean one. The app case runs the rule on the web entry of `scripts/architecture/web.entry.ts`.
 *
 * `-t isolation` selects ISC-431 (spec 061): no folder under the web entry's `features/` imports another, statically,
 * type-only or through a dynamic `import()`, on one fixture root per form and a clean one. The app case runs the rule
 * on the web entry, which carries the area `webIsolation`.
 *
 * `-t routes` selects ISC-412: the route families `spectant serve` joins (`routeFamilies` in `server/src/cli/`) name
 * every route once, and the set of method and route they answer equals the one the golden master recorded
 * (`tests/fixtures/golden/routes.json`, `writes.json`), every route hit by a recorded request.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import config, { type LaneEntry } from "../scripts/architecture.config.ts";
import { routeFamilies } from "../server/src/cli/routes.ts";
import type { RouteFamily, RouteMatch } from "../server/src/infra/http/router.ts";
import type { Violation } from "../scripts/architecture/files.ts";
import { imports } from "../scripts/architecture/imports.ts";
import { io } from "../scripts/architecture/io.ts";
import { isolation } from "../scripts/architecture/isolation.ts";
import { layers } from "../scripts/architecture/layers.ts";
import { layout } from "../scripts/architecture/layout.ts";
import { web, webIsolation } from "../scripts/architecture/web.entry.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");
const FIXTURES = "tests/fixtures/architecture";

const server = config.lanes.find((lane) => lane.name === "server");
if (server === undefined) throw new Error("scripts/architecture.config.ts has no server entry");
const app: LaneEntry = server;

/** A lane entry over one fixture root, with the server entry's layout and imports sections. */
function fixture(path: string): LaneEntry {
  return {
    name: `fixture-${path.replace("/", "-")}`,
    root: `${FIXTURES}/${path}`,
    extensions: [".ts"],
    ignore: [],
    ...(app.layout === undefined ? {} : { layout: app.layout }),
    ...(app.imports === undefined ? {} : { imports: app.imports }),
    ...(app.io === undefined ? {} : { io: app.io }),
  };
}

function at(path: string, detail: string, line?: number): Violation {
  return { rule: "", file: `${FIXTURES}/${path}`, ...(line === undefined ? {} : { line }), detail };
}

describe("layout", () => {
  const expected = (path: string, detail: string): Violation => ({ ...at(path, detail), rule: "layout" });

  test("a clean root: main.ts, the areas and a slice with index.ts and a nested folder", () => {
    expect(layout(fixture("layout/clean"), REPO_ROOT)).toEqual([]);
  });

  test("a stray top-level file is reported", () => {
    expect(layout(fixture("layout/stray"), REPO_ROOT)).toEqual([
      expected(
        "layout/stray/stray.ts",
        `outside every slice and area (only main.ts may sit directly in ${FIXTURES}/layout/stray)`,
      ),
    ]);
  });

  test("a slice without index.ts is reported once, at its folder", () => {
    expect(layout(fixture("layout/no-entry"), REPO_ROOT)).toEqual([
      expected("layout/no-entry/spec", "slice spec has no index.ts"),
    ]);
  });

  test("an entry without layout settings is not checked", () => {
    const entry: LaneEntry = { ...fixture("layout/stray"), layout: undefined };
    expect(layout(entry, REPO_ROOT)).toEqual([]);
  });

  test("the app: server/src has only main.ts on top and every slice has index.ts", () => {
    expect(layout(app, REPO_ROOT)).toEqual([]);
  });
});

describe("imports", () => {
  const expected = (path: string, line: number, detail: string): Violation => ({
    ...at(path, detail, line),
    rule: "imports",
  });

  test("a clean graph: slice to slice through index.ts, areas without slices, main.ts reaching deep", () => {
    expect(imports(fixture("imports/clean"), REPO_ROOT)).toEqual([]);
  });

  test("a slice reaching past another slice's index.ts is reported, type-only imports included", () => {
    expect(imports(fixture("imports/deep"), REPO_ROOT)).toEqual([
      expected("imports/deep/a/index.ts", 1, "slice a imports b/internal.ts, not b/index.ts"),
      expected("imports/deep/a/index.ts", 2, "slice a imports b/shape.ts, not b/index.ts"),
    ]);
  });

  test("an area importing a slice is reported, even through its index.ts", () => {
    expect(imports(fixture("imports/area"), REPO_ROOT)).toEqual([
      expected("imports/area/contracts/a.contract.ts", 1, "area contracts imports slice a (a/index.ts)"),
      expected("imports/area/infra/log.ts", 1, "area infra imports slice a (a/index.ts)"),
    ]);
  });

  test("a cycle between slices is reported once, with its path", () => {
    expect(imports(fixture("imports/cycle"), REPO_ROOT)).toEqual([
      expected("imports/cycle/a/index.ts", 1, "cycle between slices a → b → c → a"),
    ]);
  });

  test("an entry without imports settings is not checked", () => {
    const entry: LaneEntry = { ...fixture("imports/cycle"), imports: undefined };
    expect(imports(entry, REPO_ROOT)).toEqual([]);
  });

  test("the app: the server/src graph keeps all three rules", () => {
    expect(imports(app, REPO_ROOT)).toEqual([]);
  });
});

describe("io rule", () => {
  const expected = (path: string, line: number, detail: string): Violation => ({ ...at(path, detail, line), rule: "io" });

  test("the server entry guards the four modules and three calls of ISC-411, allowed in infra only", () => {
    expect(app.io).toEqual({
      allowedIn: ["infra"],
      modules: ["node:fs", "node:fs/promises", "node:child_process", "bun:sqlite"],
      calls: ["Bun.spawn", "Bun.file", "Bun.write"],
    });
  });

  test("a slice importing node:fs is reported, with the bare, type-only and dynamic forms", () => {
    expect(io(fixture("io/module"), REPO_ROOT)).toEqual([
      expected("io/module/notes/index.ts", 1, "node:fs"),
      expected("io/module/notes/store.ts", 1, "bun:sqlite"),
      expected("io/module/notes/store.ts", 2, "fs/promises (node:fs/promises)"),
      expected("io/module/notes/store.ts", 9, "node:child_process"),
    ]);
  });

  test("a slice calling Bun.file, Bun.spawn or destructuring Bun.write is reported at each use", () => {
    expect(io(fixture("io/call"), REPO_ROOT)).toEqual([
      expected("io/call/spec/index.ts", 3, "Bun.file"),
      expected("io/call/spec/run.ts", 1, "Bun.write"),
      expected("io/call/spec/run.ts", 3, "Bun.spawn"),
    ]);
  });

  test("a mention in a comment, string, template or regex literal is not a call", () => {
    expect(io(fixture("io/mention"), REPO_ROOT)).toEqual([]);
  });

  test("infra/ may use every listed module and call", () => {
    expect(io(fixture("io/allowed"), REPO_ROOT)).toEqual([]);
  });

  test("an entry without io settings is not checked", () => {
    const entry: LaneEntry = { ...fixture("io/module"), io: undefined };
    expect(io(entry, REPO_ROOT)).toEqual([]);
  });

  test("the app: no file outside server/src/infra does direct I/O", () => {
    expect(io(app, REPO_ROOT)).toEqual([]);
  });
});

describe("layers", () => {
  const expected = (path: string, line: number, detail: string): Violation => ({
    ...at(path, detail, line),
    rule: "layers",
  });
  /** The web entry over a fixture root under `layers/`: its extensions, ignore list (`features/**`) and order. */
  const layered = (path: string): LaneEntry => ({ ...web, name: `fixture-layers-${path}`, root: `${FIXTURES}/layers/${path}` });

  test("the web entry orders the layers core, shared, layout, features", () => {
    expect(web.layers).toEqual({ order: ["core", "shared", "layout", "features"] });
  });

  test("a clean graph: each layer imports only earlier ones, a root file anything, packages are no layer", () => {
    expect(layers(layered("clean"), REPO_ROOT)).toEqual([]);
  });

  test("core importing shared is reported", () => {
    expect(layers(layered("core-shared"), REPO_ROOT)).toEqual([
      expected("layers/core-shared/core/clock.ts", 1, "core imports shared (shared/format.ts)"),
    ]);
  });

  test("shared importing layout is reported, type-only imports included", () => {
    expect(layers(layered("shared-layout"), REPO_ROOT)).toEqual([
      expected("layers/shared-layout/shared/format.ts", 2, "shared imports layout (layout/shell.ts)"),
    ]);
  });

  test("layout importing an ignored features file is reported, extensionless as the web app writes it", () => {
    expect(layers(layered("layout-features"), REPO_ROOT)).toEqual([
      expected("layers/layout-features/layout/shell.ts", 2, "layout imports features (features/home.ts)"),
    ]);
  });

  test("an entry without layers settings is not checked", () => {
    const entry: LaneEntry = { ...layered("core-shared"), layers: undefined };
    expect(layers(entry, REPO_ROOT)).toEqual([]);
  });

  // Red until the base layers of web/src/app keep the order (spec 060); then a plain `test`.
  test("the app: web/src/app keeps core ← shared ← layout ← features", () => {
    expect(layers(web, REPO_ROOT)).toEqual([]);
  });
});

describe("isolation", () => {
  const expected = (path: string, line: number, detail: string): Violation => ({
    ...at(path, detail, line),
    rule: "isolation",
  });
  /** The web entry over a fixture root under `isolation/`, with its feature area switched on. */
  const isolated = (path: string): LaneEntry => ({
    ...web,
    name: `fixture-isolation-${path}`,
    root: `${FIXTURES}/isolation/${path}`,
    isolation: webIsolation,
  });

  test("the web entry's isolation area is features/", () => {
    expect(webIsolation).toEqual({ area: "features" });
  });

  test("a clean area: features import core, shared and their own folder; root and generated files are not checked", () => {
    expect(isolation(isolated("clean"), REPO_ROOT)).toEqual([]);
  });

  test("a feature importing another feature is reported, type-only imports included", () => {
    expect(isolation(isolated("static"), REPO_ROOT)).toEqual([
      expected("isolation/static/features/a/page.ts", 1, "a imports b (features/b/widget.ts)"),
      expected("isolation/static/features/a/page.ts", 2, "a imports b (features/b/shape.ts)"),
    ]);
  });

  test("a feature loading another feature with a dynamic import() is reported", () => {
    expect(isolation(isolated("dynamic"), REPO_ROOT)).toEqual([
      expected("isolation/dynamic/features/a/routes.ts", 3, "a imports b (features/b/page.ts)"),
    ]);
  });

  test("a file directly in the feature area is a feature of its own", () => {
    expect(isolation(isolated("loose"), REPO_ROOT)).toEqual([
      expected("isolation/loose/features/a/page.ts", 1, "a imports helper.ts (features/helper.ts)"),
    ]);
  });

  test("an entry without isolation settings is not checked", () => {
    const entry: LaneEntry = { ...isolated("static"), isolation: undefined };
    expect(isolation(entry, REPO_ROOT)).toEqual([]);
  });

  test("the app: no folder of web/src/app/features imports another", () => {
    expect(web.isolation).toEqual(webIsolation);
    expect(isolation(web, REPO_ROOT)).toEqual([]);
  });
});

/** One recorded answer of the golden master (`tests/fixtures/golden/routes.json`, `writes.json`'s entries). */
interface Recorded {
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
}

function goldenFile(name: string): unknown {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, "tests/fixtures/golden", name), "utf8"));
}

/** The methods an `Allow` header names. */
function methodsOf(allow: string): string[] {
  return allow
    .split(",")
    .map((method) => method.trim())
    .filter((method) => method !== "");
}

describe("routes", () => {
  // The families exactly as `spectant serve` joins them, the app database included.
  const families: ReadonlyArray<RouteFamily<string, RouteMatch>> = routeFamilies({ db: true });
  const familyOf = new Map(families.flatMap((family) => family.routes.map((route) => [route, family] as const)));
  const recorded = [...(goldenFile("routes.json") as Recorded[]), ...(goldenFile("writes.json") as { entries: Recorded[] }).entries];

  /** The route that answers the method on the path, first claim first, as the router walks the families. */
  function routeOf(pathname: string, method: string): string | null {
    for (const family of families) {
      if (!family.claims(pathname, method)) continue;
      const match = family.match(pathname);
      if (match !== null) return `${family.name}/${match.route}`;
      if (family.unmatched === "not-found") return null;
    }
    return null;
  }

  test("every route is named exactly once across the slices' families", () => {
    const names = families.flatMap((family) => family.routes);
    expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([]);
    expect(families.map((family) => family.name)).toEqual(["events", "workspace-admin", "settings", "actors", "lifeos", "workspace", "notes", "spec", "prototype"]);
  });

  test("the set of method and route equals the golden master's, and every route is hit", () => {
    const hits = new Map<string, Set<string>>();
    const unmapped: string[] = [];
    const golden = new Set<string>();
    for (const entry of recorded) {
      const { pathname } = new URL(entry.path, "http://127.0.0.1");
      const route = routeOf(pathname, entry.method);
      if (route === null) {
        const api = pathname.startsWith("/api/") || pathname.startsWith("/proto/");
        if (api && entry.status !== 404) unmapped.push(`${entry.name}: ${entry.method} ${entry.path} ${entry.status}`);
        continue;
      }
      const name = route.slice(route.indexOf("/") + 1);
      hits.set(name, (hits.get(name) ?? new Set<string>()).add(pathname));
      // A 405 names the methods its path takes; a 403 is the guard's, before the method; any other answer took it.
      if (entry.status === 405) {
        for (const method of methodsOf(entry.headers.allow ?? "")) golden.add(`${method} ${routeOf(pathname, method) ?? "no route"}`);
      } else if (entry.status !== 403) {
        golden.add(`${entry.method} ${route}`);
      }
    }

    const answered = new Set<string>();
    for (const [name, paths] of hits) {
      const family = familyOf.get(name);
      if (family === undefined) continue;
      for (const pathname of paths) {
        for (const method of methodsOf(family.allow(name, pathname))) answered.add(`${method} ${routeOf(pathname, method) ?? "no route"}`);
      }
    }

    expect(unmapped).toEqual([]);
    expect(families.flatMap((family) => family.routes).filter((name) => !hits.has(name))).toEqual([]);
    expect([...answered].sort()).toEqual([...golden].sort());
  });
});
