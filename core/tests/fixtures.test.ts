// Fixture corpus (ISC-69, spec 002 T6): the trees `core/` is tested against are present and publishable.
// `spectant-001/` is Spectant's own spec 001 frozen at a named commit, `leadgen/` holds real specs of more than one
// type under their Apache licence, and `harbor/`, `lantern/` and `empty-master/` are the synthetic trees. The frozen
// trees are copies of real repositories, so every file in them is checked for machine paths and personal names.
//
// This file reads fixture files only; it parses nothing through `core/`. The one frontmatter lookup below is a
// test helper for a single key, not a parser of the format.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

const FIXTURES = join(import.meta.dir, "..", "fixtures");
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

// Golden snapshot tests (ISC-6, spec 001 T40) go below this line.
