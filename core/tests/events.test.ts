// T30 (spec 002, ISC-32): the events.jsonl validator of T16. Every line of every fixture events.jsonl validates
// against `{ts, from, to, command, actor}`; each rejection reason is proven once with its `event-…` code and line
// number; the older lifecycle words normalise to the stage table's names with a warning; `parseEvents` keeps file
// order and skips blank lines; and the validated lines feed the timeline as recorded stage transitions, while a spec
// without events.jsonl still derives its stages (ISC-36).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { deriveStages } from '../src/derived-stages.ts';
import { EVENT_STAGES, EVENT_VOCABULARY_ALIASES, parseEvents, validateEventLine } from '../src/events.ts';
import type { SpecFiles } from '../src/files.ts';
import { STAGE_RULES } from '../src/stage.ts';
import { buildTimeline } from '../src/timeline.ts';
import { FIXTURES, fixtureTrees, folders } from './helpers/read-tree.ts';

const HARBOR = join(FIXTURES, 'harbor');
const HARBOR_001 = 'specs/archive/001-manifest-sync';

/** A harbor spec folder read whole, as the server reads it. */
function harborFolder(relDir: string): SpecFiles {
  const parent = join(HARBOR, relDir, '..');
  const name = relDir.split('/').pop() ?? relDir;
  const hit = folders(parent).find((f) => f.folder === name);
  if (hit === undefined) throw new Error(`no fixture folder ${relDir}`);
  return hit;
}

/** Every `events.jsonl` under core/fixtures/, as `[tree-relative path, text]`. */
function fixtureEventFiles(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (dir: string, rel: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name), `${rel}/${e.name}`);
      else if (e.name === 'events.jsonl') out.push([`${rel}/${e.name}`, readFileSync(join(dir, e.name), 'utf8')]);
    }
  };
  for (const tree of fixtureTrees()) walk(join(FIXTURES, tree), tree);
  return out;
}

const line = (fields: Record<string, unknown>): string => JSON.stringify(fields);
const VALID = { ts: '2026-03-07T15:30:00Z', from: 'review', to: 'build', command: '/spec-review 002', actor: 'principal' };

describe('the vocabulary (principal decision 2026-09-29)', () => {
  test('the event stages are the stage table of stage.ts, one vocabulary for timeline and stage', () => {
    expect([...EVENT_STAGES].sort()).toEqual(STAGE_RULES.map((r) => r.stage).sort());
    expect(EVENT_STAGES).toHaveLength(8);
  });

  test('the alias table maps every older lifecycle word to a stage name, `idea` to the creation', () => {
    expect(EVENT_VOCABULARY_ALIASES).toEqual({
      idea: null,
      specified: 'plan',
      planned: 'tasks',
      tasked: 'review',
      reviewed: 'build',
      implementing: 'build',
      'code-reviewed': 'close',
    });
    for (const [word, stage] of Object.entries(EVENT_VOCABULARY_ALIASES)) {
      expect(EVENT_STAGES.includes(word)).toBe(false);
      if (stage !== null) expect(EVENT_STAGES.includes(stage)).toBe(true);
    }
  });
});

describe('fixtures: every events.jsonl line is valid', () => {
  const files = fixtureEventFiles();

  test('at least one fixture carries an events.jsonl, and it is harbor 001', () => {
    expect(files.map(([path]) => path)).toContain(`harbor/${HARBOR_001}/events.jsonl`);
  });

  test.each(files)('%s', (_path, text) => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    expect(lines.length).toBeGreaterThan(0);
    for (const [i, raw] of lines.entries()) {
      const v = validateEventLine(raw, i + 1);
      expect(v).toMatchObject({ ok: true, warnings: [] });
    }
    const parsed = parseEvents(text);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.events).toHaveLength(lines.length);
  });

  test('harbor 001 records its whole chain in the new vocabulary, the creation first', () => {
    const { events } = parseEvents(readFileSync(join(HARBOR, HARBOR_001, 'events.jsonl'), 'utf8'));
    expect(events.map((e) => [e.from, e.to])).toEqual([
      [null, 'plan'],
      ['plan', 'tasks'],
      ['tasks', 'review'],
      ['review', 'build'],
      ['build', 'code-review'],
      ['code-review', 'close'],
      ['close', 'done'],
    ]);
    // The same chain the files derive: the recording and the derivation agree on every transition.
    const derived = deriveStages(harborFolder(HARBOR_001)).map((e): Array<string | null> => [e.from ?? null, e.to ?? null]);
    expect(events.map((e) => [e.from, e.to])).toEqual(derived);
  });
});

describe('validateEventLine: a valid line', () => {
  test('returns the event with its keys in schema order and no warnings', () => {
    const v = validateEventLine(line(VALID), 1);
    expect(v).toEqual({ ok: true, event: VALID, warnings: [] });
    if (v.ok) expect(Object.keys(v.event)).toEqual(['ts', 'from', 'to', 'command', 'actor']);
  });

  test('accepts a `ts` with an offset and with fractional seconds', () => {
    expect(validateEventLine(line({ ...VALID, ts: '2026-03-07T17:30:00+02:00' })).ok).toBe(true);
    expect(validateEventLine(line({ ...VALID, ts: '2026-03-07T15:30:00.277Z' })).ok).toBe(true);
  });

  test('accepts `from: null` as a line of its own (the creation; parseEvents decides where it may stand)', () => {
    expect(validateEventLine(line({ ...VALID, from: null, to: 'plan' }))).toMatchObject({ ok: true, event: { from: null, to: 'plan' } });
  });

  test('never throws, not even without an argument', () => {
    expect(() => (validateEventLine as (...args: unknown[]) => unknown)()).not.toThrow();
  });
});

describe('validateEventLine: each rejection reason once, as a diagnostic with its line', () => {
  const cases: Array<[string, string, string, string]> = [
    ['malformed JSON', '{"ts":"2026-03-07T15:30:00Z",', 'event-json', 'JSON'],
    ['not an object', '["2026-03-07T15:30:00Z","review","build"]', 'event-not-object', 'object'],
    ['a missing key', line({ ts: VALID.ts, from: 'review', to: 'build', command: '/spec-review 002' }), 'event-missing-key', 'actor'],
    ['an extra key', line({ ...VALID, note: 'by hand' }), 'event-extra-key', 'note'],
    ['a field of the wrong type', line({ ...VALID, actor: 7 }), 'event-type', 'actor'],
    ['a date without a time', line({ ...VALID, ts: '2026-03-07' }), 'event-ts', '2026-03-07'],
    ['a time without a zone', line({ ...VALID, ts: '2026-03-07T15:30:00' }), 'event-ts', '2026-03-07T15:30:00'],
    ['a day the calendar lacks', line({ ...VALID, ts: '2026-02-30T10:00:00Z' }), 'event-ts', '2026-02-30'],
    ['`from` outside the vocabulary', line({ ...VALID, from: 'shipping' }), 'event-stage', 'shipping'],
    ['`to` outside the vocabulary', line({ ...VALID, to: 'archived' }), 'event-stage', 'archived'],
    ['`from` equal to `to`', line({ ...VALID, from: 'build', to: 'build' }), 'event-same-stage', 'build'],
    ['an empty command', line({ ...VALID, command: '  ' }), 'event-empty', 'command'],
    ['an empty actor', line({ ...VALID, actor: '' }), 'event-empty', 'actor'],
  ];

  test.each(cases)('%s → %s', (_name, raw, code, named) => {
    const v = validateEventLine(raw, 4);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.diagnostic).toMatchObject({ severity: 'error', code, line: 4 });
    expect(v.diagnostic.message).toContain(named);
  });

  test('every rejection code is proven exactly once above (plus the null-from rule of parseEvents)', () => {
    const codes = cases.map(([, , code]) => code);
    expect(new Set(codes)).toEqual(
      new Set(['event-json', 'event-not-object', 'event-missing-key', 'event-extra-key', 'event-type', 'event-ts', 'event-stage', 'event-same-stage', 'event-empty']),
    );
  });

  test('without a line number the diagnostic carries none', () => {
    const v = validateEventLine('nope');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.diagnostic.line).toBeUndefined();
  });

  test('`to: null` is not a stage: the creation has a null `from`, never a null `to`', () => {
    const v = validateEventLine(line({ ...VALID, to: null }), 2);
    expect(v).toMatchObject({ ok: false, diagnostic: { code: 'event-type', line: 2 } });
  });
});

describe('the older lifecycle words (ISC-24 wording) are read and normalised', () => {
  test('`tasked → reviewed` reads as `review → build`, with one warning naming each old word', () => {
    const v = validateEventLine(line({ ...VALID, from: 'tasked', to: 'reviewed' }), 9);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.event).toEqual({ ...VALID, from: 'review', to: 'build' });
    expect(v.warnings.map((w) => [w.severity, w.code, w.line])).toEqual([
      ['warning', 'event-alias', 9],
      ['warning', 'event-alias', 9],
    ]);
    expect(v.warnings[0]?.message).toContain('tasked');
    expect(v.warnings[0]?.message).toContain('review');
    expect(v.warnings[1]?.message).toContain('reviewed');
    expect(v.warnings[1]?.message).toContain('build');
  });

  test('`idea → specified` is the creation: `null → plan`', () => {
    const v = validateEventLine(line({ ...VALID, from: 'idea', to: 'specified' }));
    expect(v).toMatchObject({ ok: true, event: { from: null, to: 'plan' } });
  });

  test('a stage name beside an old word warns once, for the old word only', () => {
    const v = validateEventLine(line({ ...VALID, from: 'build', to: 'code-reviewed' }));
    expect(v).toMatchObject({ ok: true, event: { from: 'build', to: 'close' } });
    if (v.ok) expect(v.warnings.map((w) => w.message.includes('code-reviewed'))).toEqual([true]);
  });

  test('`reviewed → implementing` is `build → build` in the stage table: skipped with a warning, not an error', () => {
    const v = validateEventLine(line({ ...VALID, from: 'reviewed', to: 'implementing' }), 5);
    expect(v).toMatchObject({ ok: false, diagnostic: { severity: 'warning', code: 'event-same-stage', line: 5 } });
    if (!v.ok) {
      expect(v.diagnostic.message).toContain('reviewed');
      expect(v.diagnostic.message).toContain('implementing');
    }
  });
});

describe('parseEvents', () => {
  const a = line({ ts: '2026-03-02T09:00:00Z', from: null, to: 'plan', command: '/spec-feature manifest-sync', actor: 'principal' });
  const b = line({ ts: '2026-03-02T09:40:00Z', from: 'plan', to: 'tasks', command: '/spec-plan 001', actor: 'principal' });
  const c = line({ ts: '2026-03-02T10:20:00Z', from: 'tasks', to: 'review', command: '/spec-tasks 001', actor: 'principal' });

  test('keeps file order, skips blank and whitespace-only lines, reads CRLF', () => {
    const { events, diagnostics } = parseEvents(['', a, '   ', b, '', c, ''].join('\r\n'));
    expect(diagnostics).toEqual([]);
    expect(events.map((e) => e.to)).toEqual(['plan', 'tasks', 'review']);
  });

  test('an invalid line becomes a diagnostic at its file line; the lines around it still count', () => {
    const { events, diagnostics } = parseEvents([a, '', '{oops', b, line({ ...VALID, from: 'x' }), c].join('\n'));
    expect(events.map((e) => e.to)).toEqual(['plan', 'tasks', 'review']);
    expect(diagnostics.map((d) => [d.code, d.line])).toEqual([
      ['event-json', 3],
      ['event-stage', 5],
    ]);
  });

  test('a null `from` stands only on the creation: the first event of the file', () => {
    const late = line({ ...VALID, from: null, to: 'review' });
    const { events, diagnostics } = parseEvents([a, late, b].join('\n'));
    expect(events.map((e) => e.to)).toEqual(['plan', 'tasks']);
    expect(diagnostics).toMatchObject([{ severity: 'error', code: 'event-null-from', line: 2 }]);
  });

  test('alias warnings come through beside the normalised events', () => {
    const { events, diagnostics } = parseEvents(line({ ...VALID, from: 'tasked', to: 'reviewed' }));
    expect(events).toEqual([{ ...VALID, from: 'review', to: 'build' }]);
    expect(diagnostics.map((d) => [d.severity, d.code, d.line])).toEqual([
      ['warning', 'event-alias', 1],
      ['warning', 'event-alias', 1],
    ]);
  });

  test('an empty text has no events and no diagnostics, and nothing throws', () => {
    expect(parseEvents('')).toEqual({ events: [], diagnostics: [] });
    expect(parseEvents('\n\n')).toEqual({ events: [], diagnostics: [] });
    expect(() => parseEvents('\u0000{]')).not.toThrow();
  });
});

describe('the timeline reads events.jsonl (ISC-32 feeding ISC-36)', () => {
  test('harbor 001: recorded stage entries with actor and command, none derived', () => {
    const files = harborFolder(HARBOR_001);
    expect(files.texts.events).toBeDefined();
    const stages = buildTimeline({ files, commits: [] }).filter((e) => e.kind === 'stage');
    expect(stages).toHaveLength(7);
    for (const e of stages) {
      expect(e.derived).toBe(false);
      expect(e.undated).toBeUndefined();
      expect(typeof e.actor).toBe('string');
      expect(e.command).toMatch(/^\/spec-/);
      expect(Number.isFinite(Date.parse(e.ts))).toBe(true);
    }
    // Newest first: done by /spec-complete, the creation last, titled like a derived creation.
    expect(stages[0]).toMatchObject({ from: 'close', to: 'done', command: '/spec-complete 001', actor: 'principal' });
    expect(stages.at(-1)).toMatchObject({ from: null, to: 'plan', title: 'created → plan' });
    expect(buildTimeline({ files, commits: [] }).some((e) => e.derived)).toBe(false);
  });

  test('events the caller passes win over the file: both paths stay', () => {
    const files = harborFolder(HARBOR_001);
    const one = [{ ts: '2026-03-05T15:00:00Z', from: 'close', to: 'done', command: '/spec-complete 001', actor: 'agent' }];
    const stages = buildTimeline({ files, commits: [], events: one }).filter((e) => e.kind === 'stage');
    expect(stages.map((e) => [e.to, e.actor])).toEqual([['done', 'agent']]);
  });

  test('a spec without events.jsonl still derives its stages, marked derived', () => {
    const files = harborFolder('specs/002-web-console');
    expect(files.texts.events).toBeUndefined();
    const stages = buildTimeline({ files, commits: [] }).filter((e) => e.kind === 'stage');
    expect(stages.length).toBeGreaterThan(0);
    expect(stages.every((e) => e.derived && e.actor === null)).toBe(true);
  });

  test('an events.jsonl whose every line is invalid derives, as if it were absent', () => {
    const files = harborFolder(HARBOR_001);
    const broken: SpecFiles = { folder: files.folder, texts: { ...files.texts, events: '{oops\n{"ts":1}\n' } };
    const stages = buildTimeline({ files: broken, commits: [] }).filter((e) => e.kind === 'stage');
    expect(stages.map((e) => [e.from, e.to])).toEqual(deriveStages(files).map((e) => [e.from, e.to]).reverse());
    expect(stages.every((e) => e.derived)).toBe(true);
  });

  test('the fixture file exists where FORMAT.md quotes it', () => {
    expect(existsSync(join(HARBOR, HARBOR_001, 'events.jsonl'))).toBe(true);
    expect(readFileSync(join(FIXTURES, '..', '..', 'FORMAT.md'), 'utf8')).toContain(
      `From \`core/fixtures/harbor/${HARBOR_001}/events.jsonl\``,
    );
  });
});
