// The fixture corpus and its golden test.
//
// Corpus (ISC-69, spec 002 T6): the trees `core/` is tested against are present and publishable. `spectant-001/` is
// Spectant's own spec 001 frozen at a named commit, `leadgen/` holds real specs of more than one type under their
// Apache licence, and `harbor/`, `lantern/` and `empty-master/` are the synthetic trees. The frozen trees are copies
// of real repositories, so every file in them is checked for machine paths and personal names. The corpus tests read
// fixture files only; the one frontmatter lookup below is a test helper for a single key, not a parser of the format.
//
// Golden (ISC-6, spec 001 T40): every tree parses through `buildDashboard` without error to its snapshot
// `core/fixtures/<name>.golden.json`. `UPDATE_GOLDEN=1 bun test core/tests/fixtures.test.ts` writes the snapshots;
// every other run compares byte-equal. A snapshot changes only together with the parser change that explains it
// (core/CLAUDE.md § Fixtures).
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

import { buildDashboard } from "../src/dashboard.ts";
import type { DashboardModel } from "../src/dashboard.ts";
import { FIXTURES, fixtureTrees, readTree } from "./helpers/read-tree.ts";

const SPECTANT_001 = join(FIXTURES, "spectant-001");
const LEADGEN = join(FIXTURES, "leadgen");

/** Paths (relative to `core/fixtures/`) from `rels` under `root` that do not exist. */
function missingUnder(root: string, rels: string[]): string[] {
  return rels.map((rel) => join(root, rel)).filter((path) => !existsSync(path)).map((path) => relative(FIXTURES, path));
}

/** Test helper: the value of one top-level `key:` line in a fixture file's frontmatter, unquoted, or undefined. */
function testOnlyFrontmatterValue(text: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:[ \\t]*(\\S.*?)[ \\t]*$`, "m").exec(text);
  return match?.[1]?.replace(/^["']|["']$/g, "");
}

/** Every `spec.md` one directory below `specs/` and one below `specs/archive/`. */
function specFilesUnder(root: string): string[] {
  const found: string[] = [];
  for (const base of [join(root, "specs"), join(root, "specs", "archive")]) {
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const spec = join(base, entry.name, "spec.md");
      if (existsSync(spec)) found.push(spec);
    }
  }
  return found;
}

/** Every regular file below `dir`, recursively. */
function filesBelow(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesBelow(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

describe("corpus", () => {
  test("spectant-001 is Spectant's spec 001 frozen at a named commit", () => {
    const specDir = join("specs", "001-app-skeleton");
    expect(missingUnder(SPECTANT_001, ["COMMIT", "ISA.md", join(specDir, "spec.md"), join(specDir, "rounds.jsonl")])).toEqual([]);

    const commit = readFileSync(join(SPECTANT_001, "COMMIT"), "utf8").split(/\r?\n/)[0] ?? "";
    expect(commit).toMatch(/^[0-9a-f]{7,40}$/);

    const spec = readFileSync(join(SPECTANT_001, specDir, "spec.md"), "utf8");
    expect(testOnlyFrontmatterValue(spec, "spec_type")).toBe("feature");
    expect(testOnlyFrontmatterValue(spec, "slug")).toBe("001-app-skeleton");

    const rounds = readFileSync(join(SPECTANT_001, specDir, "rounds.jsonl"), "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "");
    expect(rounds.length).toBeGreaterThanOrEqual(1);
    const unparsable = rounds.filter((line) => {
      try {
        JSON.parse(line);
        return false;
      } catch {
        return true;
      }
    });
    expect(unparsable).toEqual([]);
  });

  test("leadgen holds at least three specs of at least two types, with its Apache licence note", () => {
    expect(missingUnder(LEADGEN, ["LICENSE-leadgen.txt", "ISA.md", "specs"])).toEqual([]);
    expect(readFileSync(join(LEADGEN, "LICENSE-leadgen.txt"), "utf8")).toContain("Apache");

    const specs = specFilesUnder(LEADGEN);
    expect(specs.length).toBeGreaterThanOrEqual(3);

    const untyped = specs.filter((path) => testOnlyFrontmatterValue(readFileSync(path, "utf8"), "spec_type") === undefined);
    expect(untyped.map((path) => relative(FIXTURES, path))).toEqual([]);

    const types = new Set(specs.map((path) => testOnlyFrontmatterValue(readFileSync(path, "utf8"), "spec_type")));
    expect(types.size).toBeGreaterThanOrEqual(2);
  });

  test("the synthetic trees harbor, lantern and empty-master each have a master", () => {
    expect(missingUnder(FIXTURES, ["harbor/ISA.md", "lantern/ISA.md", "empty-master/ISA.md"])).toEqual([]);
  });

  test("the frozen trees name no machine path and no person", () => {
    const roots = [SPECTANT_001, LEADGEN];
    expect(roots.filter((root) => !existsSync(root) || !statSync(root).isDirectory()).map((root) => relative(FIXTURES, root))).toEqual([]);

    const offending: string[] = [];
    for (const file of roots.flatMap(filesBelow)) {
      const text = readFileSync(file, "utf8");
      if (text.includes("/Users/")) offending.push(`${relative(FIXTURES, file)}: /Users/`);
      // Licence attributions are the one place a person's name may appear (constitution § Adaptations, XC-10).
      const isLicenceNotice = /^LICENSE-[^/]+\.txt$/.test(basename(file));
      if (!isLicenceNotice && /marcello/i.test(text)) offending.push(`${relative(FIXTURES, file)}: marcello`);
    }
    expect(offending).toEqual([]);
  });
});

/** The golden text: two-space JSON with a trailing newline. Field order is the model's construction order. */
const golden = (m: DashboardModel): string => `${JSON.stringify(m, null, 2)}\n`;

/** The first line where two texts part, with two lines of context, for a readable failure. */
function firstDifference(expected: string, actual: string): string {
  const a = expected.split("\n");
  const b = actual.split("\n");
  const at = a.findIndex((line, i) => line !== b[i]);
  const i = at < 0 ? Math.min(a.length, b.length) : at;
  const around = (lines: string[]) => lines.slice(Math.max(0, i - 2), i + 3).join("\n");
  return `golden differs at line ${i + 1}\n--- golden\n${around(a)}\n+++ built\n${around(b)}`;
}

/** `file: code` for every diagnostic of the given severity in the model. */
const diagnosticsOf = (m: DashboardModel, severity: "error" | "warning"): string[] =>
  m.diagnostics.filter((d) => d.diagnostic.severity === severity).map((d) => `${d.file}: ${d.diagnostic.code}`);

/**
 * The warnings each tree is expected to carry, as `file: code`; no tree may carry an error. Harbor's planted findings
 * (006's drift, the stale marks, 005's fog, 004's missing diagram) are dashboard warnings on the rows, not parse
 * diagnostics, so harbor parses to zero diagnostics. The one warning is leadgen's: the frozen copy's own `ISA.md`
 * declares `progress: 31/33` while the recount is 31/32. That is upstream text frozen at a named commit, not a parser
 * fault, so it stays and is pinned here.
 */
const EXPECTED_WARNINGS: Record<string, string[]> = {
  harbor: [],
  lantern: [],
  "empty-master": [],
  "spectant-001": [],
  leadgen: ["ISA.md: master-progress-mismatch"],
};

const UPDATE_HINT = "run UPDATE_GOLDEN=1 bun test core/tests/fixtures.test.ts";

describe("golden snapshots", () => {
  const trees = fixtureTrees();
  const update = process.env.UPDATE_GOLDEN === "1";

  test("every fixture tree has a golden snapshot, every snapshot a tree", () => {
    const goldens = readdirSync(FIXTURES)
      .filter((name) => name.endsWith(".golden.json"))
      .map((name) => name.slice(0, -".golden.json".length))
      .sort();
    expect(trees.length).toBeGreaterThan(0);
    expect(goldens).toEqual(trees);
    expect(Object.keys(EXPECTED_WARNINGS).sort()).toEqual(trees);
  });

  test.each(trees)("%s parses without error", (name) => {
    const m = buildDashboard(readTree(name));
    expect(diagnosticsOf(m, "error")).toEqual([]);
    expect(diagnosticsOf(m, "warning")).toEqual(EXPECTED_WARNINGS[name] ?? []);
  });

  test("the error check is not vacuous: a folder without spec.md is an error", () => {
    const m = buildDashboard({ master: null, constitution: null, tldr: null, specs: [{ folder: "009-no-spec", texts: { plan: "# plan only\n" } }], archived: [] });
    expect(diagnosticsOf(m, "error")).toEqual(["specs/009-no-spec/spec.md: spec-missing"]);
  });

  test.each(trees)("%s.golden.json", (name) => {
    const built = golden(buildDashboard(readTree(name)));
    const path = join(FIXTURES, `${name}.golden.json`);
    if (update) writeFileSync(path, built);
    if (!existsSync(path)) throw new Error(`${name}.golden.json is missing; ${UPDATE_HINT}`);
    const stored = readFileSync(path, "utf8");
    if (stored !== built) throw new Error(`${firstDifference(stored, built)}\nOnly a parser change explains a new snapshot; then ${UPDATE_HINT}`);
    expect(stored).toBe(built);
  });
});
