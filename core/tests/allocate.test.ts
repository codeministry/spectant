// T85 (ISC-130.2): the allocation of a story, planned in memory: the next free spec number and the first texts of the
// new folder `specs/NNN-<slug>/` (spec.md, context.md) plus its creation event. Probes by name: "number" and
// "allocation". `allocate.ts` writes nothing; the fixture is read here, in the test.
import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { allocationOf, nextSpecNumber, specNumbersOf } from '../src/allocate.ts';
import { parseClaims } from '../src/claims.ts';
import { validateEventLine } from '../src/events.ts';
import { parseFrontmatter } from '../src/frontmatter.ts';
import { readIdeas } from '../src/ideas.ts';
import { FIXTURES, ideaFilesAt } from './helpers/read-tree.ts';

const HARBOR = join(FIXTURES, 'harbor');
const NOW = new Date('2026-03-10T08:15:00Z');
const TS = '2026-03-10T08:15:00.000Z';
const ACTOR = 'u:3f9c0a7d';

/** harbor's folder names in `specs/` and `specs/archive/`. */
function harborFolders(): string[] {
  const specs = join(HARBOR, 'specs');
  return [...readdirSync(specs), ...readdirSync(join(specs, 'archive'))];
}

describe('allocate: number (T85, ISC-130.2)', () => {
  test('number: an empty repository starts at 1', () => {
    expect(nextSpecNumber([])).toBe(1);
  });

  test('number: one past the highest taken number; a gap below it is never reused', () => {
    expect(nextSpecNumber([1, 2, 3])).toBe(4);
    expect(nextSpecNumber([1, 7])).toBe(8);
    expect(nextSpecNumber([7, 3, 5])).toBe(8);
  });

  test("number: the caller's numbers from branch names and history count like folders", () => {
    const folders = specNumbersOf(harborFolders());
    expect(nextSpecNumber(folders)).toBe(10);
    expect(nextSpecNumber([...folders, 12])).toBe(13);
  });

  test('number: values that are no spec number are ignored', () => {
    expect(nextSpecNumber([Number.NaN, -4, 2.5, 0, 3])).toBe(4);
  });

  test('number: folders are read by their three-digit prefix, the archive among them; other names are skipped', () => {
    expect(specNumbersOf(['002-web-console', '001-manifest-sync', 'ideas', 'constitution.md', '12-short', 'archive'])).toEqual([2, 1]);
    expect(specNumbersOf(harborFolders()).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('allocate: allocation (T85, ISC-130.2)', () => {
  const ideaFiles = ideaFilesAt(HARBOR);
  const idea = readIdeas(ideaFiles).ideas.find((i) => i.slug === 'console-audit-log');
  const story = ideaFiles['console-audit-log.md'] ?? '';
  if (idea === undefined) throw new Error('harbor has no console-audit-log story');
  const allocation = allocationOf(idea, story, 10, NOW, ACTOR);

  test('allocation: the folder is NNN-<slug> with the number zero-padded to three digits', () => {
    expect(allocation.folder).toBe('010-console-audit-log');
    expect(allocationOf(idea, story, 7, NOW, ACTOR).folder).toBe('007-console-audit-log');
  });

  test("allocation: spec.md's frontmatter parses back with the story's keys, stage plan and phase scoping", () => {
    const fm = parseFrontmatter(allocation.specText);
    expect(fm.diagnostics).toEqual([]);
    expect(fm.present).toBe(true);
    expect(fm.data).toMatchObject({
      slug: '010-console-audit-log',
      specType: 'feature',
      isaFeature: 'F2',
      milestone: 'Harbor 2.0',
      priority: 'P3',
      stage: 'plan',
      phase: 'scoping',
      started: TS,
      updated: TS,
    });
    expect(Object.keys(fm.rest)).toEqual([]);
  });

  test('allocation: spec.md is claimless and holds the story title under ## Goal', () => {
    const claims = parseClaims(allocation.specText);
    expect(claims.claims).toEqual([]);
    expect(claims.counted).toEqual({ closed: 0, total: 0 });
    expect(allocation.specText).toContain(`## Goal\n\n${idea.title}\n`);
    expect(allocation.specText).toContain('# 010 — Console audit log\n');
  });

  test('allocation: a story without type, feature or milestone leaves those keys out', () => {
    const bare = allocationOf({ ...idea, type: null, feature: null, milestone: null, priority: 'P1' }, story, 11, NOW, ACTOR);
    const fm = parseFrontmatter(bare.specText);
    expect(fm.diagnostics).toEqual([]);
    expect(Object.keys(fm.values)).toEqual(['slug', 'priority', 'stage', 'phase', 'started', 'updated']);
    expect(fm.data.priority).toBe('P1');
  });

  test('allocation: a value the reader would cut is written quoted and reads back as written', () => {
    const odd = allocationOf({ ...idea, milestone: 'Q3 # late "beta" \\ x' }, story, 11, NOW, ACTOR);
    const fm = parseFrontmatter(odd.specText);
    expect(fm.diagnostics).toEqual([]);
    expect(fm.data.milestone).toBe('Q3 # late "beta" \\ x');
  });

  test("allocation: context.md's Round 0 is the story's prompt, verbatim after the frontmatter", () => {
    const body = parseFrontmatter(story).body.replace(/^\n+/, '').trimEnd();
    expect(allocation.contextText).toContain(`## Round 0 — the story, ${TS}\n\n${body}\n`);
    expect(allocation.contextText).not.toContain('status: idea');
    const fm = parseFrontmatter(allocation.contextText);
    expect(fm.values).toEqual({ spec: '010-console-audit-log', created: TS, updated: TS, rounds: '1' });
  });

  test('allocation: the shaping record travels into context.md', () => {
    const shaped = `${story.trimEnd()}\n\n## Shaping record\n\n### Q1 · Which log?\n- Chosen: one file\n`;
    const text = allocationOf(idea, shaped, 10, NOW, ACTOR).contextText;
    expect(text).toContain('## Shaping record\n\n### Q1 · Which log?\n- Chosen: one file\n');
  });

  test('allocation: the creation event is from null to plan by /spec new <slug> and validates', () => {
    expect(allocation.event).toEqual({ ts: TS, from: null, to: 'plan', command: '/spec new console-audit-log', actor: ACTOR });
    const checked = validateEventLine(JSON.stringify(allocation.event), 1);
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.warnings).toEqual([]);
  });

  test('allocation: a number outside 1 to 999, or an invalid time, has no allocation and throws', () => {
    expect(() => allocationOf(idea, story, 0, NOW, ACTOR)).toThrow(RangeError);
    expect(() => allocationOf(idea, story, 1000, NOW, ACTOR)).toThrow(RangeError);
    expect(() => allocationOf(idea, story, 10, new Date(Number.NaN), ACTOR)).toThrow(RangeError);
  });

  test('allocation: the story text is not changed and only the four parts are returned', () => {
    expect(Object.keys(allocation).sort()).toEqual(['contextText', 'event', 'folder', 'specText']);
    expect(ideaFiles['console-audit-log.md']).toBe(story);
  });
});
