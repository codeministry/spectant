// FORMAT.md's glossary is GLOSSARY, row by row (spec 008 T41, ISC-116).
//
// FORMAT.md is the written contract (core/CLAUDE.md). `core/src/glossary.ts` carries every row of the table under
// `## Glossary` as data. The test reads FORMAT.md at test time, takes the table's rows and compares each with its
// exported row: the same terms in the same order, the same cell texts after trimming, and the markdown line the row
// renders to, verbatim. Either side changing alone fails here.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as core from '../src/index.ts';
import { GLOSSARY, type GlossaryRow } from '../src/glossary.ts';

const ROOT = join(import.meta.dir, '..', '..');

const TABLE_HEAD = ['| Spectant term | Common term | German | Definition |', '|---------------|-------------|--------|------------|'];

/** The lines of the first table under `## Glossary` in FORMAT.md, header and rule line included, verbatim. */
function formatGlossaryTable(): string[] {
  const lines = readFileSync(join(ROOT, 'FORMAT.md'), 'utf8').split(/\r?\n/);
  const heading = lines.indexOf('## Glossary');
  expect(heading).toBeGreaterThan(-1);
  const next = lines.findIndex((line, i) => i > heading && line.startsWith('## '));
  const from = lines.findIndex((line, i) => i > heading && (next < 0 || i < next) && line.startsWith('|'));
  expect(from).toBeGreaterThan(heading);
  const to = lines.findIndex((line, i) => i > from && !line.startsWith('|'));
  return lines.slice(from, to < 0 ? undefined : to);
}

/** The trimmed cells of one markdown table line. */
function cellsOf(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** A row as the markdown line FORMAT.md must hold for it. */
function renderRow(row: GlossaryRow): string {
  return `| ${row.term} | ${row.common} | ${row.german} | ${row.definition} |`;
}

describe('FORMAT.md holds GLOSSARY verbatim', () => {
  const table = formatGlossaryTable();
  const body = table.slice(TABLE_HEAD.length);

  test('the header names the four columns', () => {
    expect(table.slice(0, 2)).toEqual(TABLE_HEAD);
  });

  test('exactly thirteen rows on both sides', () => {
    expect(GLOSSARY).toHaveLength(13);
    expect(body).toHaveLength(13);
  });

  test('the terms are unique', () => {
    expect(new Set(GLOSSARY.map((row) => row.term)).size).toBe(GLOSSARY.length);
  });

  test('the same terms in the same order', () => {
    expect(body.map((line) => cellsOf(line)[0])).toEqual(GLOSSARY.map((row) => row.term));
  });

  GLOSSARY.forEach((row, i) => {
    test(`row ${i + 1}: ${row.term}`, () => {
      const line = body[i] ?? '';
      expect(cellsOf(line)).toEqual([row.term, row.common, row.german, row.definition]);
      expect(line).toBe(renderRow(row));
    });
  });
});

describe('glossary export', () => {
  test('rides the browser-safe barrel', () => {
    expect(core.GLOSSARY).toBe(GLOSSARY);
  });

  test('every cell is trimmed, non-empty text without a pipe', () => {
    for (const row of GLOSSARY) {
      for (const cell of [row.term, row.common, row.german, row.definition]) {
        expect(cell.trim()).toBe(cell);
        expect(cell.length).toBeGreaterThan(0);
        expect(cell).not.toContain('|');
      }
    }
  });

  test('the module imports nothing: no file system, no node: module', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'src', 'glossary.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toContain('node:');
  });
});
