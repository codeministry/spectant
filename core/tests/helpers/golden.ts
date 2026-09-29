// Test helper: the one golden-snapshot harness for `core/fixtures/`. Every golden file is two-space JSON with a
// trailing newline, compared byte for byte; `UPDATE_GOLDEN=1` is the only path that rewrites one. A snapshot moves
// only together with the parser change that explains it (core/CLAUDE.md § Fixtures).
//
// Naming: `<tree>.golden.json` is the dashboard model (spec 001, `fixtures.test.ts`); `<tree>.<family>.golden.json`
// is one of spec 002's models (`golden.test.ts`). `goldenFiles()` splits every name back into tree and family.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { FIXTURES } from './read-tree.ts';

/** The family of a `<tree>.golden.json` file: spec 001's dashboard model. */
export const DASHBOARD_FAMILY = 'dashboard';

/** The golden text of a model: two-space JSON with a trailing newline. Field order is the model's construction order. */
export const goldenText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** Path of the golden file of `tree` in `family`. */
export function goldenPath(tree: string, family: string): string {
  return join(FIXTURES, family === DASHBOARD_FAMILY ? `${tree}.golden.json` : `${tree}.${family}.golden.json`);
}

/** Every golden file under `core/fixtures/`, split into tree and family, in name order. */
export function goldenFiles(): Array<{ file: string; tree: string; family: string }> {
  return readdirSync(FIXTURES)
    .filter((file) => file.endsWith('.golden.json'))
    .sort()
    .map((file) => {
      const stem = file.slice(0, -'.golden.json'.length);
      const dot = stem.indexOf('.');
      return dot < 0
        ? { file, tree: stem, family: DASHBOARD_FAMILY }
        : { file, tree: stem.slice(0, dot), family: stem.slice(dot + 1) };
    });
}

/** The trees that have a golden file in `family`, in name order. */
export const goldenTrees = (family: string): string[] =>
  goldenFiles()
    .filter((g) => g.family === family)
    .map((g) => g.tree);

/**
 * Null when `stored` equals `built` byte for byte; otherwise the first line where they part, 1-based, with two lines
 * of context on either side, for a readable failure.
 */
export function goldenMismatch(stored: string, built: string): string | null {
  if (stored === built) return null;
  const a = stored.split('\n');
  const b = built.split('\n');
  const at = a.findIndex((line, i) => line !== b[i]);
  const i = at < 0 ? Math.min(a.length, b.length) : at;
  const around = (lines: string[]): string => lines.slice(Math.max(0, i - 2), i + 3).join('\n');
  return `golden differs at line ${i + 1}\n--- golden\n${around(a)}\n+++ built\n${around(b)}`;
}

/**
 * Compares `built` byte for byte with the golden file at `path`; under `UPDATE_GOLDEN=1` it writes `built` there
 * first. Throws with the first differing line and the rewrite command (`updateCommand`) otherwise.
 */
export function expectGolden(path: string, built: string, updateCommand: string): void {
  if (process.env.UPDATE_GOLDEN === '1') writeFileSync(path, built);
  const hint = `run UPDATE_GOLDEN=1 ${updateCommand}`;
  if (!existsSync(path)) throw new Error(`${path.slice(FIXTURES.length + 1)} is missing; ${hint}`);
  const mismatch = goldenMismatch(readFileSync(path, 'utf8'), built);
  if (mismatch !== null) throw new Error(`${mismatch}\nOnly a parser change explains a new snapshot; then ${hint}`);
}
