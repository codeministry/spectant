#!/usr/bin/env bun
/**
 * check-architecture — ISC-415: the file-size, duplicate and import-boundary guards are one command with one
 * configuration entry per lane (spec 059).
 *
 * Usage: bun scripts/check-architecture.ts                 (checks every entry of scripts/architecture.config.ts)
 *        bun scripts/check-architecture.ts --config FILE   (checks the entries of FILE instead; used by the tests)
 *
 * The configuration's default export is an `ArchitectureConfig` (`scripts/architecture.config.ts`): a list of lane
 * entries, each with a root relative to the repository root. Every rule of `RULES` runs over every entry that has the
 * rule's section; an entry without the section is skipped by that rule. Each rule lives in
 * `scripts/architecture/<rule>.ts` as a pure function `(entry, repoRoot) => Violation[]`, so a new lane is a new entry
 * and a new rule is one file and one row in `RULES`; this script changes for neither.
 *
 * Why: the limits keep `server/src` in reviewable slices once it is split, and the same limits apply to the web lanes
 * later without a second guard.
 *
 * Output: one `<rule> <file>[:line] <detail>` per violation on stderr, then a summary, exit 1; otherwise
 * `architecture: 0 violations, N entries (…)` on stdout and exit 0. Paths are relative to the repository root.
 * Exit 2 on a usage error: an unknown argument, a configuration that does not load or has no lane list, a lane
 * whose root is not a folder, a rule's tool that cannot run (jscpd missing or failing for `duplicates`).
 */
import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { ArchitectureConfig, LaneEntry } from "./architecture.config.ts";
import { DuplicatesToolError, duplicates } from "./architecture/duplicates.ts";
import type { Rule, Violation } from "./architecture/files.ts";
import { imports } from "./architecture/imports.ts";
import { layout } from "./architecture/layout.ts";
import { size } from "./architecture/size.ts";

type Section = "size" | "duplicates" | "layout" | "imports" | "io";

/** The registered rules, each with the entry section that switches it on. */
const RULES: ReadonlyArray<{ name: string; section: Section; run: Rule }> = [
  { name: "size", section: "size", run: size },
  { name: "duplicates", section: "duplicates", run: duplicates },
  { name: "layout", section: "layout", run: layout },
  { name: "imports", section: "imports", run: imports },
];

const REPO_ROOT = resolve(import.meta.dir, "..");
const DEFAULT_CONFIG = join(import.meta.dir, "architecture.config.ts");

class UsageError extends Error {}

function configPath(args: string[]): string {
  if (args.length === 0) return DEFAULT_CONFIG;
  const [flag, value] = args;
  if (flag === "--config" && value !== undefined && args.length === 2) return resolve(value);
  throw new UsageError(`unknown arguments: ${args.join(" ")} (usage: check-architecture.ts [--config FILE])`);
}

function isConfig(value: unknown): value is ArchitectureConfig {
  if (typeof value !== "object" || value === null || !("lanes" in value) || !Array.isArray(value.lanes)) return false;
  return value.lanes.every(
    (lane: unknown) =>
      typeof lane === "object" &&
      lane !== null &&
      "name" in lane &&
      typeof lane.name === "string" &&
      "root" in lane &&
      typeof lane.root === "string" &&
      "extensions" in lane &&
      Array.isArray(lane.extensions) &&
      "ignore" in lane &&
      Array.isArray(lane.ignore),
  );
}

async function loadConfig(path: string): Promise<ArchitectureConfig> {
  let loaded: { default?: unknown };
  try {
    loaded = (await import(pathToFileURL(path).href)) as { default?: unknown };
  } catch (error) {
    throw new UsageError(`cannot load ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isConfig(loaded.default)) throw new UsageError(`${path} has no default export with a lane list`);
  return loaded.default;
}

function assertRoot(entry: LaneEntry): void {
  let isDir = false;
  try {
    isDir = statSync(join(REPO_ROOT, entry.root)).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) throw new UsageError(`lane ${entry.name}: root ${entry.root} is not a folder`);
}

function format(v: Violation): string {
  return `${v.rule} ${v.file}${v.line === undefined ? "" : `:${v.line}`} ${v.detail}`;
}

async function main(): Promise<number> {
  let config: ArchitectureConfig;
  try {
    config = await loadConfig(configPath(process.argv.slice(2)));
    config.lanes.forEach(assertRoot);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`architecture: ${error.message}`);
    return 2;
  }

  const violations: Violation[] = [];
  for (const entry of config.lanes) {
    for (const rule of RULES) {
      if (entry[rule.section] === undefined) continue;
      try {
        violations.push(...rule.run(entry, REPO_ROOT));
      } catch (error) {
        if (!(error instanceof DuplicatesToolError)) throw error;
        console.error(`architecture: lane ${entry.name}: ${rule.name}: ${error.message}`);
        return 2;
      }
    }
  }

  const lanes = config.lanes.map((entry) => entry.name).join(", ");
  const summary = `architecture: ${violations.length} violations, ${config.lanes.length} entries (${lanes})`;
  if (violations.length === 0) {
    console.log(summary);
    return 0;
  }
  for (const v of violations) console.error(format(v));
  console.error(summary);
  return 1;
}

process.exit(await main());
