/**
 * architecture — the folder-shape and import-graph rules of `scripts/check-architecture.ts` (spec 059).
 *
 * `-t layout` selects ISC-409, `-t imports` ISC-410, `-t io` ISC-411 (no other test name holds "io"). Each rule
 * runs on one fixture root per clause under
 * `tests/fixtures/architecture/`, with the server entry's own `layout` and `imports` sections, and must return exactly
 * the expected violations. The app case runs the rule on the real server entry of `scripts/architecture.config.ts`; it
 * stays `test.failing` while `server/src` is flat and turns into a plain `test` when the split is done (T61).
 */
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import config, { type LaneEntry } from "../scripts/architecture.config.ts";
import type { Violation } from "../scripts/architecture/files.ts";
import { imports } from "../scripts/architecture/imports.ts";
import { io } from "../scripts/architecture/io.ts";
import { layout } from "../scripts/architecture/layout.ts";

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

  test.failing("the app: server/src has only main.ts on top and every slice has index.ts", () => {
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

  test.failing("the app: the server/src graph keeps all three rules", () => {
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
