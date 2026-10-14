// The tech page (spec 023, ISC-134): `specs/tech.md` read by its four section markers into three documents (overview
// and stack joined), and per spec its title, its goal, the first paragraph of its approach and its open fog. Inline
// texts, and the fixture trees for the title the dashboard row shows.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildDashboard } from '../src/dashboard.ts';
import type { SpecFiles } from '../src/files.ts';
import { readTech, type TechSectionHead, techSectionHeads } from '../src/tech.ts';
import { FIXTURES, readTree } from './helpers/read-tree.ts';

const TECH = `---
title: Harbor
lang: en
---
Text before the first marker belongs to no section.

<!-- section: overview -->
## Overview

Harbor syncs boats.

<!-- section: stack -->
## Stack

Bun and SQLite.

<!-- section: architecture -->
## Architecture

\`\`\`mermaid
flowchart LR
  a --> b
\`\`\`

![Map](img/map.png)

![Outside](../secret.png)

<!-- section: risks -->
## Risks

Disk fills up.

<!-- section: overview -->
A second overview part.
`;

const spec = (frontmatter: string, body: string): string => `---\n${frontmatter}\n---\n# Title\n\n${body}`;

const SPECS: SpecFiles[] = [
  {
    folder: '010-late',
    texts: {
      spec: spec('spec_type: bug\nphase: complete', '## Goal\n\nLate goal.\n\n## Not yet specified\n\n- fog: closed fog\n'),
    },
  },
  {
    folder: '002-sync',
    texts: {
      spec: spec(
        'spec_type: feature\nphase: implement',
        '## Goal\n\nSync every boat.\n\nTwice a day.\n\n## Not yet specified\n\n- fog: which port first\n- fog: retry budget\n',
      ),
      plan: '# Plan\n\n## Approach\n\n<!-- note -->\n\nPoll the **harbor** API\nevery hour.\n\nSecond paragraph.\n\n## Risks\n\nNone.\n',
    },
  },
  { folder: '003-no-plan', texts: { spec: spec('spec_type: spike\ntask: Pick the first port', '## Ziel\n\nEin Ziel.\n') } },
  { folder: '004-no-spec', texts: { plan: '## Approach\n\nOrphan.\n' } },
  { folder: '005-no-approach', texts: { spec: spec('spec_type: chore', 'No goal here.\n'), plan: '## Risks\n\nNone.\n' } },
];

describe('tech.md', () => {
  const model = readTech({ tech: TECH, specs: [] });

  test('the markers split the sections; text before the first marker is dropped; a repeated key is joined', () => {
    const pages = model.pages;
    expect(pages).not.toBeNull();
    const overview = pages?.overview.html ?? '';
    expect(overview).not.toContain('belongs to no section');
    expect(overview).toContain('Harbor syncs boats.');
    expect(overview).toContain('A second overview part.');
    expect(overview).toContain('Bun and SQLite.');
    // overview, then its second part, then stack: the parts of one key join in file order before stack follows.
    expect(overview.indexOf('A second overview part.')).toBeLessThan(overview.indexOf('Bun and SQLite.'));
    expect(pages?.overview.toc.map((t) => t.text)).toEqual(['Overview', 'Stack']);
    expect(pages?.risks.html).toContain('Disk fills up.');
    expect(pages?.risks.html).not.toContain('Harbor syncs boats.');
    expect(model.diagnostics).toEqual([]);
  });

  test('a mermaid fence in architecture becomes a figure; an image outside specs/ is flagged missing', () => {
    const architecture = model.pages?.architecture;
    expect(architecture?.figures.map((f) => f.kind)).toEqual(['mermaid', 'image', 'image']);
    expect(architecture?.figures[0]).toMatchObject({ kind: 'mermaid', diagram: 'flowchart' });
    expect(architecture?.html).toContain('<pre class="mermaid">');
    const [, inside, outside] = architecture?.figures ?? [];
    expect(inside).toMatchObject({ src: 'img/map.png' });
    expect(inside).not.toHaveProperty('missing');
    expect(outside).toMatchObject({ src: '../secret.png', missing: true });
  });

  test('the caller answers whether an image inside specs/ exists', () => {
    const asked: string[] = [];
    const none = readTech({ tech: TECH, specs: [], assetExists: (src) => (asked.push(src), false) });
    expect(asked).toEqual(['img/map.png']);
    expect(none.pages?.architecture.figures[1]).toMatchObject({ src: 'img/map.png', missing: true });
  });

  test('a missing key adds exactly one tech-section warning, keyed to tech.md, the key as subject', () => {
    const noRisks = TECH.replace('<!-- section: risks -->', '');
    const { pages, diagnostics } = readTech({ tech: noRisks, specs: [] });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ file: 'specs/tech.md', diagnostic: { severity: 'warning', code: 'tech-section', subject: 'risks' } });
    expect(pages?.risks.html).toBe('');
    // Without its marker the risks text runs on inside architecture.
    expect(pages?.architecture.html).toContain('Disk fills up.');
  });

  test('a file without any marker warns once per key and never throws', () => {
    const { pages, diagnostics } = readTech({ tech: '---\ntitle: x\n', specs: [] });
    expect(pages).not.toBeNull();
    expect(diagnostics.filter((d) => d.diagnostic.code === 'tech-section').map((d) => d.diagnostic.subject)).toEqual([
      'overview',
      'stack',
      'architecture',
      'risks',
    ]);
  });

  test('an absent tech.md is pages: null without a diagnostic', () => {
    expect(readTech({ specs: [] })).toEqual({ pages: null, diagnostics: [], specs: [] });
  });
});

describe('specs', () => {
  const { specs } = readTech({ specs: SPECS });

  test('in numeric order; a folder without spec.md is skipped', () => {
    expect(specs.map((s) => s.slug)).toEqual(['002-sync', '003-no-plan', '005-no-approach', '010-late']);
    expect(specs.map((s) => [s.id, s.type, s.phase])).toEqual([
      ['002', 'feature', 'implement'],
      ['003', 'spike', null],
      ['005', 'chore', null],
      ['010', 'bug', 'complete'],
    ]);
  });

  test('goal: the whole ## Goal section rendered; ## Ziel counts; null without the section', () => {
    const [sync, noPlan, noApproach] = specs;
    expect(sync?.goal?.html).toContain('Sync every boat.');
    expect(sync?.goal?.html).toContain('Twice a day.');
    expect(sync?.goal?.html).not.toContain('which port first');
    expect(noPlan?.goal?.html).toContain('Ein Ziel.');
    expect(noApproach?.goal).toBeNull();
  });

  test('approach: the first prose paragraph of ## Approach; null without plan.md or without the section', () => {
    const [sync, noPlan, noApproach] = specs;
    expect(sync?.approach?.html).toContain('<strong>harbor</strong>');
    expect(sync?.approach?.html).toContain('every hour.');
    expect(sync?.approach?.html).not.toContain('Second paragraph.');
    expect(sync?.approach?.html).not.toContain('note');
    expect(noPlan?.approach).toBeNull();
    expect(noApproach?.approach).toBeNull();
  });

  test('fog: every - fog: line of an open spec; a complete spec has none', () => {
    const late = specs.at(-1);
    expect(specs[0]?.fog).toEqual(['which port first', 'retry budget']);
    expect(specs[1]?.fog).toEqual([]);
    expect(late?.phase).toBe('complete');
    expect(late?.fog).toEqual([]);
  });

  test("title: frontmatter task: when set, else the folder's slug without its number", () => {
    expect(specs.map((s) => [s.id, s.title])).toEqual([
      ['002', 'sync'],
      ['003', 'Pick the first port'],
      ['005', 'no-approach'],
      ['010', 'late'],
    ]);
  });

  test('title: equal to the dashboard row title for every spec of a fixture tree', () => {
    for (const name of ['harbor', 'leadgen']) {
      const tree = readTree(name);
      const rows = new Map(buildDashboard(tree).specs.map((row) => [row.id, row.title]));
      const tech = readTech({ specs: tree.specs }).specs;
      expect(tech.length).toBeGreaterThan(0);
      for (const s of tech) expect([s.id, s.title]).toEqual([s.id, rows.get(s.id) ?? '']);
    }
    const harbor002 = readTech({ specs: readTree('harbor').specs }).specs.find((s) => s.id === '002');
    expect(harbor002?.title).toBe('Show every sync run and its failures in a small web console');
  });
});

// The section heads of tech.md (spec 017, code review #4): the four sections in contract order, each with the first
// `##` heading inside its `<!-- section: key -->` marker, so the web selects sections by core's marker reading instead
// of re-deriving them from h2 names or positions.
describe('techSectionHeads', () => {
  const fixtureText = (name: string): string => readFileSync(join(FIXTURES, name, 'specs', 'tech.md'), 'utf-8');

  test('heads: the harbor and library fixtures name each section by its own h2, in contract order', () => {
    const want: readonly TechSectionHead[] = [
      { key: 'overview', heading: 'Overview' },
      { key: 'stack', heading: 'Stack' },
      { key: 'architecture', heading: 'Architecture' },
      { key: 'risks', heading: 'Risks' },
    ];
    expect(techSectionHeads(fixtureText('library'))).toEqual(want);
    expect(techSectionHeads(fixtureText('harbor'))).toEqual(want);
  });

  test('heads: the marker decides the key, not the heading text; file order does not matter', () => {
    const body = [
      '---',
      'title: Beacon',
      '---',
      '# Beacon',
      '<!-- section: risks -->',
      '## What can break',
      'Disk.',
      '<!-- section: architecture -->',
      'Prose before the heading.',
      '```',
      '## not a heading',
      '```',
      '## System design',
      '### Parts',
      '<!-- section: overview -->',
      '## Risks',
      'An overview headed like another section.',
      '<!-- section: stack -->',
      'No heading at all.',
    ].join('\n');
    expect(techSectionHeads(body)).toEqual([
      { key: 'overview', heading: 'Risks' },
      { key: 'stack', heading: null },
      { key: 'architecture', heading: 'System design' },
      { key: 'risks', heading: 'What can break' },
    ]);
  });

  test('heads: a key without a marker reads null, as readTech reads its section empty; no marker at all is four nulls', () => {
    const partial = '<!-- section: overview -->\n## Overview\nText.\n<!-- section: risks -->\n## Risks\nMore.';
    expect(techSectionHeads(partial).map((s) => [s.key, s.heading])).toEqual([
      ['overview', 'Overview'],
      ['stack', null],
      ['architecture', null],
      ['risks', 'Risks'],
    ]);
    expect(techSectionHeads('## Overview\n## Stack\n').map((s) => s.heading)).toEqual([null, null, null, null]);
  });
});
