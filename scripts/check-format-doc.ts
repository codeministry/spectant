#!/usr/bin/env bun
/**
 * check-format-doc — ISC-68.1: `FORMAT.md` documents every file kind the app reads, with a real example each.
 *
 * Usage: bun run check:format-doc             (checks FORMAT.md at the repository root)
 *        bun scripts/check-format-doc.ts FILE  (checks FILE instead; used by the tests)
 *
 * The kinds are `FILE_KINDS` of `core/src/files.ts`, the one enumeration the parser uses. The mapping between a kind
 * and its section is fixed: the section heading starts with the kind name in backticks and names the kind's path from
 * `files.ts`, also in backticks, e.g. `## \`gateReviewed\` — \`.gates/reviewed.json\``. For every kind the check asserts:
 *
 *   - exactly one such section, in `files.ts` order, and no section for a kind `files.ts` does not have;
 *   - the heading names the kind's path, so a path changed in `files.ts` fails here until FORMAT.md follows;
 *   - the section holds at least one fenced example;
 *   - the section holds a verbatim example from a fixture: a line `From \`core/fixtures/…\`…:` directly followed
 *     (blank lines allowed) by a fenced block whose text occurs verbatim in that file; or, where no fixture carries
 *     the kind yet, the visible marker `**No fixture yet.**`, which the summary lists by name.
 *
 * Every `From \`path\`…:` block anywhere in the document is checked verbatim against its file, relative to the
 * repository root, so a quoted example can never drift from the file it claims to quote.
 *
 * Output: `format-doc: 13 kinds documented (…)` on stdout and exit 0; otherwise one `format-doc: <kind>: <problem>`
 * per problem on stderr, then `format-doc: N of 13 kinds documented`, and exit 1. Exit 2 on a usage error.
 *
 * Pure except for the CLI at the bottom: `checkFormatDoc` takes the text and a file reader. No dependency.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FILE_KINDS, type FileKind } from '../core/src/files.ts';

export interface FormatDocReport {
  /** Kinds with a section that passed every check, in files.ts order. */
  readonly documented: FileKind[];
  /** Kinds without a section. */
  readonly missing: FileKind[];
  /** Kinds documented under the `**No fixture yet.**` marker instead of a verbatim fixture example. */
  readonly noFixture: FileKind[];
  /** `From` blocks checked verbatim across the whole document. */
  readonly verbatim: number;
  /** One line per problem, `<kind>: <problem>`. */
  readonly problems: string[];
}

/** Reads a repository-relative file; null when it does not exist. */
export type FileReader = (path: string) => string | null;

const KINDS = Object.keys(FILE_KINDS) as FileKind[];
const NO_FIXTURE = '**No fixture yet.**';
const FIXTURE_PREFIX = 'core/fixtures/';

/** A fence opener or closer: up to three spaces, then three or more backticks or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** A section heading for a kind: level two, the kind name in backticks first. */
const KIND_HEADING = /^## `([A-Za-z]+)`(.*)$/;
/** The line that introduces a verbatim example: `From \`path\`` plus an optional note, ending in a colon. */
const FROM_LINE = /^From `([^`]+)`[^`]*:\s*$/;

interface Block {
  /** 1-based line of the opening fence. */
  readonly line: number;
  readonly text: string;
  /** The `From` path that introduces the block, if one does. */
  readonly from: string | null;
}

interface Section {
  readonly name: string;
  readonly heading: string;
  readonly line: number;
  readonly body: string[];
  readonly blocks: Block[];
}

/** Level-two sections of `text` with their fenced blocks; headings inside a fence are not sections. */
function sectionsOf(text: string): { sections: Section[]; blocks: Block[] } {
  const sections: Section[] = [];
  const blocks: Block[] = [];
  let current: Section | null = null;
  let fence: { char: string; size: number; line: number; lines: string[]; from: string | null } | null = null;
  let pendingFrom: string | null = null;

  text.split(/\r?\n/).forEach((raw, i) => {
    const lineNo = i + 1;
    const f = FENCE.exec(raw);
    if (fence) {
      const closes = f !== null && (f[1] ?? '').startsWith(fence.char) && (f[1] ?? '').length >= fence.size && (f[2] ?? '').trim() === '';
      if (!closes) {
        fence.lines.push(raw);
        current?.body.push(raw);
        return;
      }
      const block: Block = { line: fence.line, text: fence.lines.join('\n'), from: fence.from };
      blocks.push(block);
      current?.blocks.push(block);
      current?.body.push(raw);
      fence = null;
      return;
    }
    if (f) {
      const marker = f[1] ?? '';
      fence = { char: marker.charAt(0), size: marker.length, line: lineNo, lines: [], from: pendingFrom };
      pendingFrom = null;
      current?.body.push(raw);
      return;
    }
    if (raw.startsWith("## ")) {
      pendingFrom = null;
      const kind = KIND_HEADING.exec(raw);
      current = { name: kind?.[1] ?? '', heading: raw, line: lineNo, body: [], blocks: [] };
      sections.push(current);
      return;
    }
    current?.body.push(raw);
    const from = FROM_LINE.exec(raw);
    if (from) pendingFrom = from[1] ?? null;
    else if (raw.trim() !== '') pendingFrom = null;
  });
  return { sections, blocks };
}

/** A repository-relative path that stays inside the repository. */
function safePath(path: string): boolean {
  return !path.startsWith('/') && !path.split('/').includes('..');
}

export function checkFormatDoc(text: string, read: FileReader): FormatDocReport {
  const { sections, blocks } = sectionsOf(text);
  const problems: string[] = [];
  const failed = new Set<string>();
  const fail = (name: string, problem: string) => {
    problems.push(`${name}: ${problem}`);
    failed.add(name);
  };

  // Every `From` block, wherever it stands, must be verbatim in its file.
  const verified = new Set<Block>();
  let verbatim = 0;
  for (const block of blocks) {
    if (block.from === null) continue;
    const section = sections.find((s) => s.blocks.includes(block));
    const owner = section === undefined ? 'document' : section.name === '' ? section.heading : section.name;
    const source = safePath(block.from) ? read(block.from) : null;
    if (source === null) {
      fail(owner, `fixture ${block.from} does not exist`);
      continue;
    }
    if (!source.replace(/\r\n?/g, '\n').includes(block.text)) {
      fail(owner, `example is not verbatim in ${block.from} (block at line ${block.line})`);
      continue;
    }
    verified.add(block);
    verbatim += 1;
  }

  const kindSections = sections.filter((s) => KIND_HEADING.test(s.heading));
  for (const s of kindSections) {
    if (!KINDS.includes(s.name as FileKind)) fail(s.name, 'section for a kind files.ts does not have');
  }

  const missing: FileKind[] = [];
  const noFixture: FileKind[] = [];
  let highest: { index: number; name: string } | null = null;
  const seen = new Set<string>();
  for (const s of kindSections) {
    const index = KINDS.indexOf(s.name as FileKind);
    if (index < 0) continue;
    if (seen.has(s.name)) {
      fail(s.name, 'more than one section');
      continue;
    }
    seen.add(s.name);
    if (highest && index < highest.index) fail(s.name, `section out of files.ts order (expected before ${highest.name})`);
    if (!highest || index > highest.index) highest = { index, name: s.name };
  }

  for (const kind of KINDS) {
    const section = kindSections.find((s) => s.name === kind);
    if (!section) {
      missing.push(kind);
      fail(kind, 'no section');
      continue;
    }
    const path = FILE_KINDS[kind].path;
    if (!section.heading.includes(`\`${path}\``)) fail(kind, `section does not name its path \`${path}\``);
    if (section.blocks.length === 0) {
      fail(kind, 'no fenced example');
      continue;
    }
    const fromFixture = section.blocks.some((b) => verified.has(b) && b.from?.startsWith(FIXTURE_PREFIX) === true);
    const marked = section.body.some((line) => line.includes(NO_FIXTURE));
    // A fixture block that failed its verbatim check is already reported; one reason per cause is enough.
    const failedFixture = section.blocks.some((b) => b.from?.startsWith(FIXTURE_PREFIX) === true && !verified.has(b));
    if (fromFixture || failedFixture) continue;
    if (marked) noFixture.push(kind);
    else fail(kind, 'no verbatim fixture example and no "No fixture yet." marker');
  }

  return {
    documented: KINDS.filter((k) => !failed.has(k)),
    missing,
    noFixture,
    verbatim,
    problems,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const root = resolve(import.meta.dir, '..');
  const args = process.argv.slice(2);
  if (args.length > 1) {
    console.error('usage: bun scripts/check-format-doc.ts [FILE]');
    process.exit(2);
  }
  const file = args[0] === undefined ? join(root, 'FORMAT.md') : resolve(args[0]);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    console.error(`format-doc: cannot read ${args[0] ?? 'FORMAT.md'}`);
    process.exit(2);
  }
  const read: FileReader = (path) => {
    try {
      return readFileSync(join(root, path), 'utf8');
    } catch {
      return null;
    }
  };

  const report = checkFormatDoc(text, read);
  const total = KINDS.length;
  if (report.problems.length > 0) {
    for (const p of report.problems) console.error(`format-doc: ${p}`);
    console.error(`format-doc: ${report.documented.length} of ${total} kinds documented`);
    process.exit(1);
  }
  const extra = report.noFixture.length > 0 ? `; no fixture yet: ${report.noFixture.join(', ')}` : '';
  console.log(`format-doc: ${total} kinds documented (${report.verbatim} examples verbatim from their files${extra})`);
}
