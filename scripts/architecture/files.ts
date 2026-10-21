/**
 * The shared shape of an architecture rule and the one file walk every rule uses (spec 059).
 *
 * A rule is a pure function `(entry, repoRoot) => Violation[]`: it reads the files of one lane entry and returns what
 * it found; printing and the exit code belong to `scripts/check-architecture.ts`.
 */
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

import type { LaneEntry } from "../architecture.config.ts";

export type Violation = {
  /** The rule's name, the first word of the output line. */
  rule: string;
  /** The file, relative to the repository root, with `/` separators. */
  file: string;
  /** The 1-based line, when the violation sits on one. */
  line?: number;
  detail: string;
};

export type Rule = (entry: LaneEntry, repoRoot: string) => Violation[];

/** Test and generated files, which no rule of any lane looks at (re-exported by `architecture.config.ts`). */
export const TEST_AND_GENERATED: string[] = ["**/*.test.ts", "**/*.spec.ts", "**/*.gen.ts"];

/** Folders no walk enters: dependencies, build output and dot-folders. */
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage"]);

/** A path relative to `from`, with `/` separators on every platform. */
export function relPath(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
}

/**
 * Every file of the entry: under its root, with one of its extensions and matching none of its ignore globs, sorted.
 * Paths are absolute.
 */
export function entryFiles(entry: LaneEntry, repoRoot: string): string[] {
  const root = join(repoRoot, entry.root);
  const ignores = entry.ignore.map((pattern) => new Bun.Glob(pattern));
  const files: string[] = [];

  const walk = (dir: string): void => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (item.name.startsWith(".") || SKIP_DIRS.has(item.name)) continue;
      const full = join(dir, item.name);
      if (item.isDirectory()) {
        walk(full);
        continue;
      }
      if (!item.isFile() || !entry.extensions.some((ext) => item.name.endsWith(ext))) continue;
      const path = relPath(root, full);
      if (ignores.some((glob) => glob.match(path))) continue;
      files.push(full);
    }
  };

  walk(root);
  return files.sort();
}
