// The marker line of the Workflow path (spec 032, T14, ISC-33.1): `skills/spec/scripts/implement.workflow.js` builds
// its own builder briefs and runs inside the Workflow sandbox, where it cannot import `src/marker.ts`; it inlines the
// marker format instead. This test runs the script with stubbed Workflow globals (`args`, `agent`, `pipeline`, `log`)
// and pins every brief's first line against `markerLine` and `parseMarker`, so the hooks see a Workflow round exactly
// as an Agent round. A spec path without its `NNN-slug` folder or a garbled task or claim fails before any builder.
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
async function prompts(spec: string, dispatch: readonly Task[]): Promise<string[]> {
  const seen: string[] = [];
  const agent = (prompt: string): Promise<unknown> => {
    seen.push(prompt);
    return Promise.resolve({ kind: 'result', exit_code: 0 });
  };
  const pipeline = async (items: readonly Task[], build: Stage, after: Stage): Promise<unknown[]> =>
    Promise.all(items.map(async (item) => after(await build(item, item), item)));
  await body({ plan: { dispatch }, brief: { spec, goal: 'The goal.' } }, agent, pipeline, () => undefined);
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
