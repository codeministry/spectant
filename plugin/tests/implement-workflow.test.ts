// The marker line of the Workflow path (spec 032, T14, ISC-33.1): `skills/spec/scripts/implement.workflow.js` builds
// its own builder briefs and runs inside the Workflow sandbox, where it cannot import `src/marker.ts`; it inlines the
// marker format instead. This test runs the script with stubbed Workflow globals (`args`, `agent`, `pipeline`, `log`)
// and pins every brief's first line against `markerLine` and `parseMarker`, so the hooks see a Workflow round exactly
// as an Agent round. A spec path without its `NNN-slug` folder or a garbled task or claim fails before any builder.
//
// The Pack brief (spec 010, T21, ISC-340): with `brief.packs[taskId]`, the output of `spec-check pack`, the prompt
// carries that JSON on one `PACK:` line in place of the instruction to read the whole `spec.md` and the GOAL and CLAIM
// lines; the marker stays the first line, and a task without a pack keeps the classic shape. The dispatch brief of
// `workflows/implement.md` Step 5 is pinned to the same shape (T20).
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markerLine, parseMarker } from '../src/marker.ts';

const SCRIPT = join(import.meta.dir, '..', 'spectant', 'skills', 'spec', 'scripts', 'implement.workflow.js');

interface Task {
  readonly id: string;
  readonly claim: string;
  readonly lane?: string;
  readonly text: string;
}

type Stage = (value: unknown, item: Task) => unknown;
type Run = (args: unknown, agent: unknown, pipeline: unknown, log: unknown) => Promise<unknown>;

// The script is a Workflow body: top-level await and return, and an `export const meta` the sandbox reads. As the body
// of an async function, with the export keyword dropped, it runs here unchanged otherwise; the wrapped copy goes to a
// module under the system temp directory and is imported from there.
const source = readFileSync(SCRIPT, 'utf8').replace(/^export const meta/mu, 'const meta');
const dir = mkdtempSync(join(tmpdir(), 'spectant-workflow-'));
const wrapped = join(dir, 'implement.workflow.mjs');
writeFileSync(wrapped, `export default async function (args, agent, pipeline, log) {\n${source}\n}\n`);
const body = ((await import(wrapped)) as { default: Run }).default;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Runs the script for one plan and returns the prompts its builders got, in dispatch order. */
async function prompts(spec: string, dispatch: readonly Task[], extra: Record<string, unknown> = {}): Promise<string[]> {
  const seen: string[] = [];
  const agent = (prompt: string): Promise<unknown> => {
    seen.push(prompt);
    return Promise.resolve({ kind: 'result', exit_code: 0 });
  };
  const pipeline = async (items: readonly Task[], build: Stage, after: Stage): Promise<unknown[]> =>
    Promise.all(items.map(async (item) => after(await build(item, item), item)));
  await body({ plan: { dispatch }, brief: { spec, goal: 'The goal.', ...extra } }, agent, pipeline, () => undefined);
  return seen;
}

const SPEC = '/repo/specs/032-plugin-activity-hooks/spec.md';
const TASKS: Task[] = [
  { id: 'T4', claim: 'ISC-33', lane: 'plugin', text: 'the first task' },
  { id: 'T14', claim: 'ISC-33.1', lane: 'plugin', text: 'the second task' },
];

describe('implement.workflow.js: every builder brief opens with the marker line', () => {
  test('the first line is markerLine of the spec number, task and claim, and parseMarker reads it back', async () => {
    const got = await prompts(SPEC, TASKS);
    expect(got).toHaveLength(2);
    for (const [i, t] of TASKS.entries()) {
      const marker = { spec: '032', task: t.id, claim: t.claim };
      expect(got[i]?.split('\n', 1)[0]).toBe(markerLine(marker));
      expect(parseMarker(got[i] ?? '')).toEqual(marker);
      expect(got[i]?.split('\n')[1]).toStartWith('SPEC:      ');
    }
  });

  test('a spec path without its NNN-slug folder fails before any builder starts', async () => {
    let started = 0;
    const run = body({ plan: { dispatch: TASKS }, brief: { spec: '/repo/spec.md', goal: 'g' } }, () => ++started, () => [], () => undefined);
    let error: unknown = null;
    await run.catch((e: unknown) => {
      error = e;
    });
    expect(String(error)).toContain('specs/NNN-slug/spec.md');
    expect(started).toBe(0);
  });

  test('a task or claim id the hooks would reject fails before any builder starts', async () => {
    for (const bad of [{ ...TASKS[0], id: 't4' }, { ...TASKS[0], claim: 'ISC-x' }] as Task[]) {
      let error: unknown = null;
      await prompts(SPEC, [bad]).catch((e: unknown) => {
        error = e;
      });
      expect(String(error)).toMatch(/must be/u);
    }
  });
});

const IMPLEMENT = join(import.meta.dir, '..', 'spectant', 'skills', 'spec', 'workflows', 'implement.md');

/** A pack as `spec-check pack <spec> T<k> --json` prints it: one compact JSON line with its line break. */
const pack = (t: Task, over: Record<string, unknown> = {}): string =>
  `${JSON.stringify({
    spec: '032-plugin-activity-hooks',
    goal: 'The goal.',
    task: { id: t.id, lane: t.lane ?? null, text: t.text, paths: [] },
    claim: { id: t.claim, text: 'The claim text.', after: [] },
    probe: { type: 'bun-test', check: 'the check', threshold: '', tool: '`bun test plugin/`' },
    lane: { name: 'plugin', context: ['plugin/CLAUDE.md'], probe: 'bun test plugin/' },
    decisions: [],
    truncated: 0,
    ...over,
  })}\n`;

const PACKS = Object.fromEntries(TASKS.map((t) => [t.id, pack(t)]));

describe('implement.workflow.js: a brief with a pack', () => {
  test('the marker stays the first line, the PACK line carries the pack JSON, and no line asks to read the whole spec', async () => {
    const got = await prompts(SPEC, TASKS, { packs: PACKS });
    expect(got).toHaveLength(2);
    for (const [i, t] of TASKS.entries()) {
      const brief = got[i] ?? '';
      const lines = brief.split('\n');
      const marker = { spec: '032', task: t.id, claim: t.claim };
      expect(lines[0]).toBe(markerLine(marker));
      expect(parseMarker(brief)).toEqual(marker);
      expect(lines[1]).toBe(`PACK:      ${pack(t).trimEnd()}`);
      expect(JSON.parse((lines[1] ?? '').slice('PACK:'.length))).toEqual(JSON.parse(pack(t)));
      expect(brief).not.toMatch(/read it first/u);
      expect(brief).not.toMatch(/^(?:GOAL|CLAIM|PROBE):/mu);
      expect(lines[2]).toMatch(/^SPEC: {6}\/repo\/specs\/032-plugin-activity-hooks\/spec\.md {3}\(fallback only: /u);
      for (const key of ['TASK', 'LANE', 'SEAM', 'STEPS', 'ISOLATION', 'RETURN']) expect(brief).toMatch(new RegExp(`^${key}:`, 'mu'));
    }
  });

  test('a task without a pack in the same round keeps the classic brief', async () => {
    const [packed, classic] = await prompts(SPEC, TASKS, { packs: { T4: PACKS.T4 } });
    expect(packed?.split('\n')[1]).toStartWith('PACK:      ');
    const lines = (classic ?? '').split('\n');
    expect(lines[0]).toBe(markerLine({ spec: '032', task: 'T14', claim: 'ISC-33.1' }));
    expect(lines[1]).toBe(`SPEC:      ${SPEC}   (read it first; you are closing one claim of it)`);
    expect(lines[2]).toBe('GOAL:      "The goal."');
    expect(lines[3]).toStartWith('CLAIM:     ISC-33.1 — ');
    expect(classic).not.toMatch(/^PACK:/mu);
  });

  test('a pack of another task or claim, or one that is no single JSON line, fails the brief before any builder starts', async () => {
    const [t] = TASKS as [Task];
    for (const bad of [pack(t, { task: { id: 'T5' } }), pack(t, { claim: { id: 'ISC-34' } }), 'not json', '{"a":\n1}']) {
      let started = 0;
      let error: unknown = null;
      const run = body({ plan: { dispatch: [t] }, brief: { spec: SPEC, goal: 'g', packs: { T4: bad } } }, () => ++started, () => [], () => undefined);
      await run.catch((e: unknown) => {
        error = e;
      });
      expect(String(error)).toMatch(/pack/u);
      expect(started).toBe(0);
    }
  });
});

describe('workflows/implement.md Step 5: the dispatch brief carries the pack', () => {
  const text = readFileSync(IMPLEMENT, 'utf8');
  const step = text.slice(text.indexOf('## Step 5: the dispatch brief'), text.indexOf('## What a builder returns'));
  const block = /```\n([\s\S]*?)\n```/u.exec(step)?.[1] ?? '';
  const lines = block.split('\n');

  test('the brief opens with the marker line, then the PACK line, and never asks to read the whole spec', () => {
    expect(lines[0]).toBe('spectant: spec=<NNN> task=T<k>|C<k> claim=ISC-N');
    expect(lines[1]).toMatch(/^PACK: {6}.*spec-check pack/u);
    expect(block).not.toMatch(/\(read it[;,]/u);
    expect(block).not.toMatch(/^(?:GOAL|CLAIM|PROBE):/mu);
    expect(block).toMatch(/^SPEC: {6}.*fallback/mu);
    for (const key of ['TASK', 'LANE', 'SEAM', 'STEPS', 'ISOLATION', 'RETURN', 'DONE']) expect(block).toMatch(new RegExp(`^${key}:`, 'mu'));
  });

  test('the parent runs spec-check pack once per dispatched task and still fills SEAM from plan.md', () => {
    expect(text).toMatch(/spec-check pack specs\/NNN-slug T<k> --json/u);
    expect(step).toMatch(/once per dispatched task/u);
    expect(block).toMatch(/^SEAM: {6}.*plan\.md/mu);
  });
});
