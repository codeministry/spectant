// The planned stage move (spec 008, T71 for ISC-121, T72 for ISC-31): `planTransition` over harbor specs read from
// disk. An accepted plan carries `spec.md` with only its `stage:` line set and exactly one event line that validates;
// a refused plan carries a reason and the next command, and neither text nor event. The illegal pairs of every type
// are asked in core/tests/stage.test.ts (`-t illegal`).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseClaims } from '../src/claims.ts';
import { validateEventLine } from '../src/events.ts';
import type { MarkState, SpecFiles, TransitionPlan, Workflow, WorkflowStage } from '../src/files.ts';
import type { ClaimCounts } from '../src/stage.ts';
import { planTransition, type TransitionInput } from '../src/transition.ts';
import { parseWorkflow } from '../src/workflow.ts';
import { FIXTURES, folders } from './helpers/read-tree.ts';

const HARBOR = join(FIXTURES, 'harbor', 'specs');
const HARBOR_WF: Workflow = parseWorkflow(readFileSync(join(HARBOR, 'workflow.md'), 'utf8'));
const DEFAULT_WF: Workflow = parseWorkflow(null);
const NOW = new Date('2026-03-10T08:00:00Z');
const ACTOR = 'u:3f9c0a7d';

function harbor(folder: string): SpecFiles {
  const files = folders(HARBOR).find((f) => f.folder === folder);
  if (!files) throw new Error(`no harbor spec ${folder}`);
  return files;
}

/** The claim partition without locks, as stage.test.ts builds it: an open claim is takeable once its `after` claims resolve. */
function partitionOf(spec: string): ClaimCounts {
  const { claims } = parseClaims(spec);
  const resolved = new Set(claims.filter((c) => c.checked || c.dropped).map((c) => c.id));
  const open = claims.filter((c) => !c.checked && !c.dropped);
  const takeable = open.filter((c) => c.after.every((id) => resolved.has(id))).length;
  return {
    takeable,
    open: open.length - takeable,
    closed: claims.filter((c) => c.checked && !c.dropped).length,
    dropped: claims.filter((c) => c.dropped).length,
  };
}

function plan(files: SpecFiles, to: WorkflowStage, patch: Partial<TransitionInput> = {}): TransitionPlan {
  return planTransition({
    files,
    workflow: HARBOR_WF,
    to,
    actor: ACTOR,
    now: NOW,
    reviewed: 'fresh',
    partition: partitionOf(files.texts.spec ?? ''),
    featureSiblingsOpen: [],
    ...patch,
  });
}

/** The lines of `after` that differ from `before` at the same index, as `[index, before, after]`. */
function changedLines(before: string, after: string): Array<[number, string | undefined, string | undefined]> {
  const a = before.split('\n');
  const b = after.split('\n');
  const out: Array<[number, string | undefined, string | undefined]> = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push([i, a[i], b[i]]);
  return out;
}

function accepted(p: TransitionPlan): Extract<TransitionPlan, { ok: true }> {
  if (!p.ok) throw new Error(`refused: ${p.reason}`);
  return p;
}

function refused(p: TransitionPlan): Extract<TransitionPlan, { ok: false }> {
  if (p.ok) throw new Error(`accepted ${p.from} → ${p.to}`);
  return p;
}

/**
 * Harbor 008 with `stage: build`, which its last event (`to: build`) confirms: explicit build under the spike row.
 * Every claim of 008 is closed, so the files derive further; that event is a step back from `close`, which holds
 * build (ISC-221.2).
 */
function harbor008AtBuild(): SpecFiles {
  const base = harbor('008-referrers-support');
  const spec = (base.texts.spec ?? '').replace('\ncontext_log:', '\nstage: build\ncontext_log:');
  const back = '{"ts":"2026-03-09T10:00:00Z","from":"close","to":"build","command":"/spec-implement 008","actor":"u:3f9c0a7d"}\n';
  return { ...base, texts: { ...base.texts, spec, events: `${base.texts.events ?? ''}${back}` } };
}

describe('planTransition: an accepted move (T71, ISC-121)', () => {
  test('harbor 002 (explicit build) to blocked: only the stage: line changes, one event that validates', () => {
    const files = harbor('002-web-console');
    const spec = files.texts.spec ?? '';
    const p = accepted(plan(files, 'blocked'));
    expect([p.from, p.to]).toEqual(['build', 'blocked']);
    expect(changedLines(spec, p.specText)).toEqual([[spec.split('\n').indexOf('stage: build'), 'stage: build', 'stage: blocked']]);
    expect(p.event).toEqual({ ts: '2026-03-10T08:00:00.000Z', from: 'build', to: 'blocked', command: '/spec-implement 002', actor: ACTOR });
    const line = JSON.stringify(p.event);
    expect(Object.keys(JSON.parse(line) as object)).toEqual(['ts', 'from', 'to', 'command', 'actor']);
    const checked = validateEventLine(line);
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.warnings).toEqual([]);
  });

  test('harbor 008 (no stage:, derived code-review) to close: the key is inserted as the last frontmatter key', () => {
    const files = harbor('008-referrers-support');
    const spec = files.texts.spec ?? '';
    expect(spec).not.toMatch(/^stage:/m);
    const p = accepted(plan(files, 'close'));
    expect([p.from, p.to]).toEqual(['code-review', 'close']);
    const lines = spec.split('\n');
    const close = lines.indexOf('---', 1);
    expect(p.specText.split('\n')).toEqual([...lines.slice(0, close), 'stage: close', ...lines.slice(close)]);
    expect(p.event).toMatchObject({ from: 'code-review', to: 'close', command: '/spec-code-review 008' });
    expect(validateEventLine(JSON.stringify(p.event)).ok).toBe(true);
  });

  test('CRLF line endings and a BOM are kept; the inserted line takes the block’s line ending', () => {
    const bom = String.fromCharCode(0xfeff);
    const body = '# 010 — Demo\r\n\r\n## Claims\r\n\r\n- [ ] ISC-1: one\r\n';
    const spec = `${bom}---\r\nslug: 010-demo\r\nspec_type: bug\r\n---\r\n${body}`;
    const p = accepted(plan({ folder: '010-demo', texts: { spec } }, 'blocked', { workflow: DEFAULT_WF }));
    expect([p.from, p.to]).toEqual(['build', 'blocked']);
    expect(p.specText).toBe(`${bom}---\r\nslug: 010-demo\r\nspec_type: bug\r\nstage: blocked\r\n---\r\n${body}`);
  });

  test('a replaced stage: line keeps its own line ending and nothing else of the file moves', () => {
    const spec = '---\r\nslug: 010-demo\r\nstage: review\r\nspec_type: bug\r\n---\r\nbody\r\n';
    const events = '{"ts":"2026-03-01T00:00:00Z","from":null,"to":"review","command":"/spec-bug demo","actor":"u:0123abcd"}\n';
    const p = accepted(plan({ folder: '010-demo', texts: { spec, events } }, 'build', { workflow: DEFAULT_WF }));
    expect(p.specText).toBe(spec.replace('stage: review', 'stage: build'));
  });

  test('pure: the input files are not touched', () => {
    const files = harbor('002-web-console');
    const before = JSON.stringify(files);
    plan(files, 'blocked');
    plan(files, 'review');
    expect(JSON.stringify(files)).toBe(before);
  });
});

describe('planTransition: the fixed gates (T71, ISC-121)', () => {
  test("build without a fresh reviewed mark is refused with the review row's reason and command", () => {
    // 006: `stage: review` contradicted by its last event (`to: build`), so its stage derives: review (mark stale).
    const p = refused(plan(harbor('006-partial-push'), 'build', { reviewed: 'stale' }));
    expect(p.from).toBe('review');
    expect(p.reason).toContain('the reviewed mark is stale');
    expect(p.command).toBe('/spec-review 006');
  });

  test('every stage past review needs the fresh mark, the detour blocked included', () => {
    const states: readonly MarkState[] = ['stale', 'missing'];
    for (const reviewed of states) {
      const p = refused(plan(harbor('002-web-console'), 'blocked', { reviewed }));
      expect(p.reason).toContain(`the reviewed mark is ${reviewed}`);
    }
  });

  test("done with an open claim is refused with the build row's reason", () => {
    const p = refused(plan(harbor('007-rotate-mirror-token'), 'done', { partition: { takeable: 1, open: 0, closed: 1, dropped: 0 } }));
    expect([p.from, p.to]).toEqual(['build', 'done']);
    expect(p.reason).toContain('1 claim is takeable');
    expect(p.command).toBe('/spec-implement 007');
  });

  test("close with an open claim that is not takeable is refused with the blocked row's reason", () => {
    // 004 has every claim closed; explicit code-review via its own text and event, the caller's partition reopens two.
    const base = harbor('004-retention-policies');
    const spec = (base.texts.spec ?? '').replace('\nphase:', '\nstage: code-review\nphase:');
    const events = '{"ts":"2026-03-08T12:00:00Z","from":"build","to":"code-review","command":"/spec-implement 004","actor":"u:3f9c0a7d"}\n';
    const p = refused(plan({ ...base, texts: { ...base.texts, spec, events } }, 'close', { partition: { takeable: 0, open: 2, closed: 28, dropped: 0 } }));
    expect([p.from, p.to]).toEqual(['code-review', 'close']);
    expect(p.reason).toContain('2 open claims, none takeable');
  });

  test('the chore reaches done once every claim is closed', () => {
    // With every claim closed the chore derives done (row 6); an explicit build, its event agreeing, stands before it
    // only after a step back (ISC-221.2): a forward move into build would yield to the derived done.
    const base = harbor('007-rotate-mirror-token');
    const spec = (base.texts.spec ?? '').replace('\nphase:', '\nstage: build\nphase:');
    const events = '{"ts":"2026-03-09T09:00:00Z","from":"done","to":"build","command":"/spec-review 007","actor":"u:3f9c0a7d"}\n';
    const p = accepted(plan({ ...base, texts: { ...base.texts, spec, events } }, 'done', { workflow: DEFAULT_WF }));
    expect([p.from, p.to]).toEqual(['build', 'done']);
    expect(p.event.command).toBe('/spec-implement 007');
  });

  test('close-pending without an open sibling is refused (code_review: feature)', () => {
    const p = refused(plan(harbor008AtBuild(), 'close-pending', { featureSiblingsOpen: [] }));
    expect([p.from, p.to]).toEqual(['build', 'close-pending']);
    expect(p.reason).toContain('close-pending needs an open sibling spec of F6');
  });

  test('close-pending past every gate is accepted (T49): the event enters close-pending and spec.md moves its stage', () => {
    const p = accepted(plan(harbor008AtBuild(), 'close-pending', { featureSiblingsOpen: ['009-chunked-upload-limits'] }));
    expect([p.from, p.to, p.event.from, p.event.to]).toEqual(['build', 'close-pending', 'build', 'close-pending']);
    expect(p.specText).toContain('\nstage: close-pending\n');
  });

  test('close-pending with an open claim is refused, whatever the siblings', () => {
    const p = refused(plan(harbor008AtBuild(), 'close-pending', { featureSiblingsOpen: ['009-chunked-upload-limits'], partition: { takeable: 1, open: 0, closed: 1, dropped: 0 } }));
    expect(p.reason).toContain('1 claim is takeable');
  });

  test('code-review under code_review: feature waits while a sibling is open', () => {
    const files = harbor008AtBuild();
    const p = refused(plan(files, 'code-review', { featureSiblingsOpen: ['009-chunked-upload-limits'] }));
    expect(p.reason).toContain('every claim is closed and F6 waits on 009-chunked-upload-limits');
    expect(accepted(plan(files, 'code-review')).to).toBe('code-review');
  });

  test('close-pending is no move under code_review: spec', () => {
    const p = refused(plan(harbor('008-referrers-support'), 'close-pending', { workflow: DEFAULT_WF, featureSiblingsOpen: ['009-chunked-upload-limits'] }));
    expect(p.reason).toContain('lists no move code-review → close-pending');
  });
});

// Spec 028 (ISC-183.2): under `code_review: none` the type's row lists no code-review, so build moves straight to close.
describe('planTransition: code_review none (ISC-183.2)', () => {
  const NONE_WF: Workflow = parseWorkflow(
    ['| type | stages | code_review |', '|------|--------|-------------|', '| spike | review · build · close · done | none |', ''].join('\n'),
  );

  test('code_review none: build → close is accepted with every claim closed and no code-reviewed mark', () => {
    expect(NONE_WF.diagnostics).toEqual([]);
    const p = accepted(plan(harbor008AtBuild(), 'close', { workflow: NONE_WF }));
    expect([p.from, p.to, p.event.from, p.event.to]).toEqual(['build', 'close', 'build', 'close']);
    expect(p.specText).toContain('\nstage: close\n');
  });

  test('code_review none: build → code-review is refused, the row lists no such stage', () => {
    const p = refused(plan(harbor008AtBuild(), 'code-review', { workflow: NONE_WF }));
    expect(p.reason).toContain('lists no move build → code-review');
  });
});

describe('planTransition: a refused move (T71, T72, ISC-31)', () => {
  test('a move the workflow does not list is refused: backward, skip, standing still', () => {
    const files = harbor('002-web-console');
    const targets: readonly WorkflowStage[] = ['review', 'done', 'build', 'idea'];
    for (const to of targets) {
      const p = refused(plan(files, to));
      expect([p.from, p.to]).toEqual(['build', to]);
      expect(p.reason.length).toBeGreaterThan(0);
      expect(p.command).toBe('/spec-implement 002');
    }
    expect(refused(plan(files, 'review')).reason).toContain('lists no move build → review');
  });

  test('a refused plan has no specText and no event key', () => {
    const p = plan(harbor('002-web-console'), 'review');
    expect(p.ok).toBe(false);
    expect(Object.keys(p).sort()).toEqual(['command', 'from', 'ok', 'reason', 'to']);
    expect('specText' in p).toBe(false);
    expect('event' in p).toBe(false);
  });

  test('a folder without spec.md, or a spec.md without frontmatter, is refused', () => {
    expect(refused(plan({ folder: '010-demo', texts: {} }, 'build')).reason).toContain('spec.md');
    const bare = { folder: '010-demo', texts: { spec: '# 010 — Demo\n- [ ] ISC-1: one\n' } };
    expect(refused(plan(bare, 'build', { workflow: DEFAULT_WF })).reason).toContain('frontmatter');
  });
});
