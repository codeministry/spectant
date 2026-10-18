// The waits counts in the Tasks tab's units (spec 021, ISC-252.1): a spec's `SpecWait.heldTasks` is the tab's `held`
// status count and `readyTasks` its `open` status count, so the spec head never names a number the tab does not show.
// The tab is built as the server's tasks route builds it: the constitution, the spec's rounds.jsonl and the spec's
// own resolved edges. Every fixture tree is checked, plus harbor with a partial hold built the way the e2e stub's
// edges overlay builds it: 002's web tasks T27, T28, T29 and T32 wait on 006, whose branch is not merged.
import { describe, expect, test } from 'bun:test';

import type { MergeState, SpecFiles } from '../src/files.ts';
import { resolveEdges, type SpecEdgesModel } from '../src/spec-edges.ts';
import { specIdOf } from '../src/spec-ref.ts';
import { parseTaskLines } from '../src/tasks.ts';
import { fixtureTrees, readTree } from './helpers/read-tree.ts';

interface Row {
  readonly spec: string;
  readonly held: number;
  readonly ready: number;
  readonly tabHeld: number;
  readonly tabOpen: number;
}

/** Per active spec with a tasks.md: the waits counts beside the tab's `held` and `open` status counts. */
function rows(model: SpecEdgesModel, mergeState: readonly MergeState[]): Row[] {
  const resolved = resolveEdges(model, mergeState);
  const out: Row[] = [];
  for (const files of model.specs) {
    const spec = specIdOf(files.folder);
    if (spec === null || files.texts.tasks === undefined) continue;
    const tab = parseTaskLines({
      tasks: files.texts.tasks,
      ...(model.constitution ? { constitution: model.constitution } : {}),
      ...(files.texts.rounds === undefined ? {} : { rounds: files.texts.rounds }),
      specEdges: resolved.edges.filter((e) => e.fromSpec === spec),
    });
    const count = (name: string): number => tab.counts.byStatus.find((c) => c.name === name)?.count ?? 0;
    const wait = resolved.waits.find((w) => w.spec === spec);
    out.push({ spec, held: wait?.heldTasks ?? -1, ready: wait?.readyTasks ?? -1, tabHeld: count('held'), tabOpen: count('open') });
  }
  return out;
}

const PARTIAL = { folder: '002-web-console', tasks: new Set(['T27', 'T28', 'T29', 'T32']), on: '006' };

/** harbor's 002 with `(after: 006)` on its web tasks, as `edgedFiles` in web/e2e/stub-api.ts adds it. */
function partialHarbor(): { model: SpecEdgesModel; mergeState: MergeState[] } {
  const tree = readTree('harbor');
  const edged = (files: SpecFiles): SpecFiles => {
    if (files.folder !== PARTIAL.folder) return files;
    const tasks = (files.texts.tasks ?? '')
      .split('\n')
      .map((line) => {
        const id = /^- \[[ x]\] (T\d+) · /.exec(line)?.[1];
        if (id === undefined || !PARTIAL.tasks.has(id)) return line;
        const group = /\(after: ([^)]*)\)/.exec(line);
        if (group) return line.replace(group[0], `(after: ${group[1] ?? ''}, ${PARTIAL.on})`);
        const path = line.lastIndexOf(' · `');
        return path === -1 ? `${line} (after: ${PARTIAL.on})` : `${line.slice(0, path)} (after: ${PARTIAL.on})${line.slice(path)}`;
      })
      .join('\n');
    return { folder: files.folder, texts: { ...files.texts, tasks } };
  };
  return {
    model: { specs: tree.specs.map(edged), archived: tree.archived, constitution: tree.constitution },
    mergeState: [{ spec: PARTIAL.on, branch: 'feature/006-partial-push', merged: false, complete: false, archived: false }],
  };
}

describe('spec waits in tab units', () => {
  test.each(fixtureTrees())('%s: heldTasks and readyTasks equal the tab held and open counts', (name) => {
    const tree = readTree(name);
    for (const row of rows({ specs: tree.specs, archived: tree.archived, constitution: tree.constitution }, tree.mergeState ?? [])) {
      expect({ spec: row.spec, held: row.held, ready: row.ready }).toEqual({ spec: row.spec, held: row.tabHeld, ready: row.tabOpen });
    }
  });

  test('harbor partial hold: the head counts are the tab counts of 002', () => {
    const { model, mergeState } = partialHarbor();
    const wait = resolveEdges(model, mergeState).waits.find((w) => w.spec === '002');
    expect(wait?.blockers).toEqual(['006']);
    expect(wait?.full).toBe(false);
    const row = rows(model, mergeState).find((r) => r.spec === '002');
    expect(row?.tabHeld).toBeGreaterThan(0);
    expect(row?.tabOpen).toBeGreaterThan(0);
    expect({ held: row?.held, ready: row?.ready }).toEqual({ held: row?.tabHeld, ready: row?.tabOpen });
  });
});
