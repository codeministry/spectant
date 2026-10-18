// FORMAT.md's state table is STATE_TABLE, row by row (spec 040, T21, ISC-228).
//
// FORMAT.md is the written contract (core/CLAUDE.md). `core/src/item-state.ts` carries every item kind with each of
// the five states as data: its meaning, how the item enters the state and how it leaves it. The test reads FORMAT.md at
// test time, takes the first table under `## The state table` and compares it with STATE_TABLE rendered as markdown,
// verbatim and row for row. The expected table is rendered from STATE_TABLE, never written out here, so either side
// changing alone fails; on a mismatch the test prints the table the section must hold, ready to paste. Every test name
// carries "state table", so `bun test core/ -t "state table"` runs exactly them.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ItemKind, ItemState } from '../src/files.ts';
import * as core from '../src/index.ts';
import { STATE_TABLE, type StateTableRow } from '../src/item-state.ts';

const ROOT = join(import.meta.dir, '..', '..');

const HEADING = '## The state table';
const TABLE_HEAD = ['| Item | State | Meaning | Entered | Left |', '|------|-------|---------|---------|------|'];

const KINDS: readonly ItemKind[] = ['spec', 'idea', 'review-mark', 'code-review-mark', 'claim', 'task'];
const STATES: readonly ItemState[] = ['open', 'waiting', 'running', 'aborted', 'done'];

/** The lines of the first table under `## The state table` in FORMAT.md, header and rule line included, verbatim. */
function formatStateTable(): string[] {
  const lines = readFileSync(join(ROOT, 'FORMAT.md'), 'utf8').split(/\r?\n/);
  const at = lines.indexOf(HEADING);
  expect(at).toBeGreaterThan(-1);
  const next = lines.findIndex((line, i) => i > at && line.startsWith('## '));
  const from = lines.findIndex((line, i) => i > at && (next < 0 || i < next) && line.startsWith('|'));
  expect(from).toBeGreaterThan(at);
  const to = lines.findIndex((line, i) => i > from && !line.startsWith('|'));
  return lines.slice(from, to < 0 ? undefined : to);
}

/** A row as the markdown line FORMAT.md must hold for it. */
function renderRow(row: StateTableRow): string {
  return `| \`${row.kind}\` | \`${row.state}\` | ${row.meaning} | ${row.entered} | ${row.left} |`;
}

describe('FORMAT.md holds STATE_TABLE verbatim (the state table, ISC-228)', () => {
  const table = formatStateTable();
  const body = table.slice(TABLE_HEAD.length);
  const expected = [...TABLE_HEAD, ...STATE_TABLE.map(renderRow)];

  test('the state table: the whole table is STATE_TABLE rendered; a mismatch prints the table to paste', () => {
    const documented = table.join('\n');
    const wanted = expected.join('\n');
    if (documented !== wanted) console.error(`FORMAT.md § The state table must hold:\n\n${wanted}\n`);
    expect(documented).toBe(wanted);
  });

  test('the state table: the header names the five columns', () => {
    expect(table.slice(0, 2)).toEqual(TABLE_HEAD);
  });

  test('the state table: one row per item kind and state on both sides, thirty', () => {
    expect(STATE_TABLE).toHaveLength(KINDS.length * STATES.length);
    expect(body).toHaveLength(STATE_TABLE.length);
  });

  STATE_TABLE.forEach((row, i) => {
    test(`the state table, row ${i + 1}: ${row.kind} ${row.state}`, () => {
      expect(body[i]).toBe(renderRow(row));
    });
  });
});

describe('the state table as data', () => {
  test('the state table: every item kind with each of the five states, kinds in order, states in order', () => {
    expect(STATE_TABLE.map((row) => `${row.kind} ${row.state}`)).toEqual(
      KINDS.flatMap((kind) => STATES.map((state) => `${kind} ${state}`)),
    );
  });

  test('the state table: every cell is trimmed, non-empty text without a pipe', () => {
    for (const row of STATE_TABLE) {
      for (const cell of [row.meaning, row.entered, row.left]) {
        expect(cell.trim()).toBe(cell);
        expect(cell.length).toBeGreaterThan(0);
        expect(cell).not.toContain('|');
      }
    }
  });

  test('the state table rides the browser-safe barrel', () => {
    expect(core.STATE_TABLE).toBe(STATE_TABLE);
  });
});
