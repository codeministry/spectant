/**
 * Rule `duplicates` (spec 059, ISC-414): no block of at least `duplicates.minTokens` tokens appears twice among the
 * files of the entry.
 *
 * The detection is the pinned jscpd CLI (`node_modules/.bin/jscpd`; it has no JS API), run once over the entry's root
 * with its extensions and ignore globs; the rule reads jscpd's JSON report and turns every clone into one violation
 * `duplicates <fileA>:<start>-<end> = <fileB>:<start>-<end> (<tokens> tokens)`. jscpd runs fully offline: no semantic,
 * history or baseline flag is ever passed, and tips are off. `.gitignore` is not honoured, so fixtures under ignored
 * folders are seen as well; what the rule skips is exactly the entry's ignore list.
 *
 * A jscpd that is missing, fails or writes no report throws `DuplicatesToolError`: the guard could not run, which is a
 * usage error (exit 2), never "0 clones".
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import type { Rule, Violation } from "./files.ts";
import { relPath } from "./files.ts";

/** The guard could not run jscpd or read its report. */
export class DuplicatesToolError extends Error {}

type CloneSide = { name: string; start: number; end: number };
type Clone = { firstFile: CloneSide; secondFile: CloneSide; tokens: number };

/** jscpd's `--format` names per file extension. */
const FORMATS: Readonly<Record<string, string>> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".css": "css",
  ".html": "markup",
};

function formatsOf(extensions: string[]): string {
  const formats = extensions.map((ext) => {
    const format = FORMATS[ext];
    if (format === undefined) throw new DuplicatesToolError(`no jscpd format for extension ${ext}`);
    return format;
  });
  return [...new Set(formats)].join(",");
}

function isClone(value: unknown): value is Clone {
  if (typeof value !== "object" || value === null) return false;
  const side = (s: unknown): boolean =>
    typeof s === "object" &&
    s !== null &&
    "name" in s &&
    typeof s.name === "string" &&
    "start" in s &&
    typeof s.start === "number" &&
    "end" in s &&
    typeof s.end === "number";
  return (
    "firstFile" in value &&
    side(value.firstFile) &&
    "secondFile" in value &&
    side(value.secondFile) &&
    "tokens" in value &&
    typeof value.tokens === "number"
  );
}

/** The clones of jscpd's JSON report. */
function readClones(reportPath: string): Clone[] {
  let report: unknown;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch (error) {
    throw new DuplicatesToolError(`cannot read the jscpd report: ${error instanceof Error ? error.message : String(error)}`);
  }
  const duplicates = typeof report === "object" && report !== null && "duplicates" in report ? report.duplicates : undefined;
  if (!Array.isArray(duplicates) || !duplicates.every(isClone)) {
    throw new DuplicatesToolError("the jscpd report has no clone list");
  }
  return duplicates;
}

/** Runs jscpd over `root` (absolute) and returns its clones; file names are as jscpd reports them. */
function runJscpd(repoRoot: string, root: string, minTokens: number, formats: string, ignore: string[]): Clone[] {
  const binary = join(repoRoot, "node_modules", ".bin", "jscpd");
  if (!existsSync(binary)) throw new DuplicatesToolError(`jscpd is not installed (${relPath(repoRoot, binary)})`);
  const output = mkdtempSync(join(tmpdir(), "spectant-jscpd-"));
  try {
    const args = [binary, ".", "--min-tokens", String(minTokens), "--format", formats, "--reporters", "json"];
    args.push("--silent", "--no-tips", "--no-gitignore", "--output", output);
    if (ignore.length > 0) args.push("--ignore", ignore.join(","));
    const run = Bun.spawnSync(args, { cwd: root, env: { ...process.env, JSCPD_NO_TIPS: "1" }, stdout: "pipe", stderr: "pipe" });
    if (run.exitCode !== 0) {
      throw new DuplicatesToolError(`jscpd exited ${run.exitCode}: ${run.stderr.toString().trim()}`);
    }
    return readClones(join(output, "jscpd-report.json"));
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

export const duplicates: Rule = (entry, repoRoot) => {
  const minTokens = entry.duplicates?.minTokens;
  if (minTokens === undefined) return [];
  const root = join(repoRoot, entry.root);
  const clones = runJscpd(repoRoot, root, minTokens, formatsOf(entry.extensions), entry.ignore);
  const where = (side: CloneSide): string => {
    const file = relPath(repoRoot, isAbsolute(side.name) ? side.name : join(root, side.name));
    return `${file}:${side.start}-${side.end}`;
  };
  // The first side's range stands in the file column, so the line reads `<fileA>:<s>-<e> = <fileB>:<s>-<e> (…)`.
  const violations: Violation[] = clones.map((clone) => ({
    rule: "duplicates",
    file: where(clone.firstFile),
    detail: `= ${where(clone.secondFile)} (${clone.tokens} tokens)`,
  }));
  const key = (v: Violation): string => `${v.file} ${v.detail}`;
  return violations.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
};
