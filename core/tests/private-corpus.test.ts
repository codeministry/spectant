// Private corpus (spec 002 T10, ISC-70): every spec tree under SPECTANT_PRIVATE_CORPUS parses with zero error
// diagnostics, and the timeline model builds for every spec folder in it.
//
// Contract (the variable is local to the principal's machine; the trees it names never enter this repository):
//
//   SPECTANT_PRIVATE_CORPUS  `:`-separated list (like PATH) of entries. An entry holding `specs/` is one repository
//                            root; any other entry is a directory whose children holding `specs/` are the roots.
//
// Behaviour: unset → one skipped test naming the variable, never a pass. Set, but no root or no spec folder found
// (empty list, missing entry, empty directory) → fails and says how many entries it saw, by basename. Set and found
// → per root one test for the tree files (ISA.md, constitution, tldr), per spec folder (active and archived) one
// test "parses with zero error diagnostics" and one for the timeline, plus the count test (roots > 0, specs > 0).
// Warnings do not fail: their codes are part of the test name, so they are visible in a passing run.
//
// Private corpora carry customer names and test names end up in CI logs. So nothing printed here carries an
// absolute path, a workspace name beyond its basename, a spec slug (only its three-digit number) or any spec text:
// diagnostics are shown as severity, code, line and the file's name inside the folder, never their message, since a
// message may quote the file (`tldr-generated-invalid`, `status` edges).
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { buildDashboard } from '../src/dashboard.ts';
import type { DashboardInput, DashboardModel, FileDiagnostic } from '../src/dashboard.ts';
import type { SpecFiles, TimelineEntry } from '../src/files.ts';
import { buildTimeline } from '../src/timeline.ts';
import { readTreeAt } from './helpers/read-tree.ts';

const CORPUS_VAR = 'SPECTANT_PRIVATE_CORPUS';
const corpusEnv = process.env[CORPUS_VAR];

/** The files a tree holds once, outside any spec folder; their names are fixed, so they are safe to print. */
const TREE_FILES: readonly string[] = ['ISA.md', 'specs/constitution.md', 'specs/tldr.md'];

// ── finding the roots ────────────────────────────────────────────────────────────────────────────────────────

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

const isRoot = (path: string): boolean => isDir(join(path, 'specs'));

/** A caught error reduced to its code: an fs error message carries the absolute path. */
function codeOf(e: unknown): string {
  const code = typeof e === 'object' && e !== null && 'code' in e ? e.code : undefined;
  return typeof code === 'string' ? code : 'error';
}

interface Discovery {
  readonly roots: readonly string[];
  /** What was seen, by basename, for the "nothing found" message. */
  readonly seen: string;
}

function discover(env: string): Discovery {
  const entries = env
    .split(':')
    .filter((p) => p.trim() !== '')
    .map((p) => resolve(p));
  const roots: string[] = [];
  const notes: string[] = [];
  for (const entry of entries) {
    const name = basename(entry);
    if (isRoot(entry)) {
      roots.push(entry);
      notes.push(`${name}: a root`);
      continue;
    }
    if (!existsSync(entry)) {
      notes.push(`${name}: missing`);
      continue;
    }
    if (!isDir(entry)) {
      notes.push(`${name}: not a directory`);
      continue;
    }
    let children: string[];
    try {
      children = readdirSync(entry).sort();
    } catch (e) {
      notes.push(`${name}: unreadable (${codeOf(e)})`);
      continue;
    }
    const found = children.map((c) => join(entry, c)).filter(isRoot);
    roots.push(...found);
    const shown = children.slice(0, 10).join(', ') + (children.length > 10 ? `, … ${children.length - 10} more` : '');
    notes.push(`${name}: ${children.length} child entr${children.length === 1 ? 'y' : 'ies'} seen${children.length ? ` (${shown})` : ''}, ${found.length} holding specs/`);
  }
  const seen = `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} in ${CORPUS_VAR}` + (notes.length ? ` — ${notes.join('; ')}` : '');
  return { roots, seen };
}

// ── reading each root ────────────────────────────────────────────────────────────────────────────────────────

interface FolderResult {
  /** `NNN`, or `archive NNN`; `(2)`, `(3)`, … when two folders share a number. */
  readonly label: string;
  readonly files: SpecFiles;
  readonly diagnostics: readonly FileDiagnostic[];
  /** The file prefix of this folder's diagnostics, stripped before printing. */
  readonly prefix: string;
  readonly timeline: TimelineCheck;
}

interface RootResult {
  readonly name: string;
  /** Set when reading the tree threw: the error code only. */
  readonly failure: string | null;
  readonly treeDiagnostics: readonly FileDiagnostic[];
  readonly folders: readonly FolderResult[];
}

function readRoot(root: string, name: string): RootResult {
  let input: DashboardInput;
  let model: DashboardModel;
  try {
    input = readTreeAt(root, null);
    model = buildDashboard(input);
  } catch (e) {
    return { name, failure: codeOf(e), treeDiagnostics: [], folders: [] };
  }
  const labels = new Map<string, number>();
  const label = (base: string): string => {
    const n = (labels.get(base) ?? 0) + 1;
    labels.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  };
  const place = (files: SpecFiles, archived: boolean) => {
    const prefix = `specs/${archived ? 'archive/' : ''}${files.folder}/`;
    return {
      label: label(`${archived ? 'archive ' : ''}${files.folder.slice(0, 3)}`),
      files,
      prefix,
      diagnostics: model.diagnostics.filter((d) => d.file.startsWith(prefix)),
      timeline: checkTimeline(files),
    };
  };
  const folders = [...input.specs.map((f) => place(f, false)), ...input.archived.map((f) => place(f, true))];
  const treeDiagnostics = model.diagnostics.filter((d) => !folders.some((f) => d.file.startsWith(f.prefix)));
  return { name, failure: null, treeDiagnostics, folders };
}

// ── printing without leaking ─────────────────────────────────────────────────────────────────────────────────

function describeDiagnostic(d: FileDiagnostic, prefix: string | null): string {
  const file = prefix !== null && d.file.startsWith(prefix) ? d.file.slice(prefix.length) : TREE_FILES.includes(d.file) ? d.file : '(file)';
  const line = d.diagnostic.line === undefined ? '' : `:${d.diagnostic.line}`;
  return `${d.diagnostic.severity} ${d.diagnostic.code} at ${file}${line}`;
}

/** `2 warnings: code-a ×2` for a test name; empty when there are none. */
function warningNote(diagnostics: readonly FileDiagnostic[]): string {
  const counts = new Map<string, number>();
  for (const d of diagnostics) if (d.diagnostic.severity === 'warning') counts.set(d.diagnostic.code, (counts.get(d.diagnostic.code) ?? 0) + 1);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return '';
  const codes = [...counts].map(([code, n]) => (n === 1 ? code : `${code} ×${n}`)).join(', ');
  return ` (${total} warning${total === 1 ? '' : 's'}: ${codes})`;
}

function expectNoErrors(diagnostics: readonly FileDiagnostic[], prefix: string | null): void {
  const errors = diagnostics.filter((d) => d.diagnostic.severity === 'error');
  if (errors.length > 0) {
    const all = diagnostics.map((d) => `  ${describeDiagnostic(d, prefix)}`).join('\n');
    throw new Error(`${errors.length} error diagnostic(s) of ${diagnostics.length}:\n${all}`);
  }
  expect(errors).toHaveLength(0);
}

interface TimelineCheck {
  readonly entries: number;
  /** Null when the timeline built and is in order; otherwise why not, without any spec text. */
  readonly problem: string | null;
}

/**
 * The timeline's order as timeline.ts defines it: newest instant first; a `ts` that does not parse only after every
 * one that does. Built with no commits: the git log is the server's input, not a file in the tree.
 */
function checkTimeline(files: SpecFiles): TimelineCheck {
  let entries: TimelineEntry[];
  try {
    entries = buildTimeline({ files, commits: [] });
  } catch (e) {
    return { entries: 0, problem: `buildTimeline threw (${e instanceof Error ? e.name : typeof e})` };
  }
  let unparsedSeen = false;
  let previous = Number.POSITIVE_INFINITY;
  for (const [i, entry] of entries.entries()) {
    const at = Date.parse(entry.ts);
    if (!Number.isFinite(at)) {
      unparsedSeen = true;
      continue;
    }
    if (unparsedSeen) return { entries: entries.length, problem: `entry ${i} (${entry.kind}) has a parsed time after an unparsed one` };
    if (at > previous) return { entries: entries.length, problem: `entry ${i} (${entry.kind}) is newer than entry ${i - 1}: not newest first` };
    previous = at;
  }
  return { entries: entries.length, problem: null };
}

// ── the probe ────────────────────────────────────────────────────────────────────────────────────────────────

const discovery: Discovery = corpusEnv === undefined ? { roots: [], seen: '' } : discover(corpusEnv);
const names = new Map<string, number>();
const results: readonly RootResult[] = discovery.roots.map((root) => {
  const base = basename(root);
  const n = (names.get(base) ?? 0) + 1;
  names.set(base, n);
  return readRoot(root, n === 1 ? base : `${base} (${n})`);
});
const specCount = results.reduce((sum, r) => sum + r.folders.length, 0);

describe('private corpus (ISC-70)', () => {
  test.skipIf(corpusEnv === undefined)(
    `finds at least one repository root and one spec folder (needs ${CORPUS_VAR}; skipped when it is unset)`,
    () => {
      if (results.length === 0) throw new Error(`no repository root (a directory holding specs/) found: ${discovery.seen}`);
      if (specCount === 0) throw new Error(`${results.length} root(s) found (${results.map((r) => r.name).join(', ')}), but no spec folder (NNN-slug) in any`);
      expect(results.length).toBeGreaterThan(0);
      expect(specCount).toBeGreaterThan(0);
    },
  );

  for (const r of results) {
    describe(r.name, () => {
      test(`tree reads and its files parse with zero error diagnostics${warningNote(r.treeDiagnostics)}`, () => {
        if (r.failure !== null) throw new Error(`reading the tree threw (${r.failure})`);
        expectNoErrors(r.treeDiagnostics, null);
      });

      for (const f of r.folders) {
        test(`spec ${f.label} parses with zero error diagnostics${warningNote(f.diagnostics)}`, () => {
          expectNoErrors(f.diagnostics, f.prefix);
        });
        test(`spec ${f.label} timeline builds newest first (${f.timeline.entries} entr${f.timeline.entries === 1 ? 'y' : 'ies'})`, () => {
          if (f.timeline.problem !== null) throw new Error(f.timeline.problem);
          expect(f.timeline.problem).toBeNull();
        });
      }
    });
  }
});
