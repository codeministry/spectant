import type { Stage } from '../../../../../core/src/stage';
import type { StatusResponse, StatusSpec, StatusWorkspace } from '../../../../../server/src/contracts/status.contract';
import {
  activeCount,
  EMPTY_FILTER,
  loadWidgetFilter,
  pruneFilter,
  saveWidgetFilter,
  stageCounts,
  stageOptions,
  visibleGroups,
  WIDGET_FILTER_KEY,
  workspaceCounts,
  workspaceOptions,
  type WidgetFilter,
} from './widget-filter';

// Spec 072 (T18, ISC-603): the widget filter's options come from the unfiltered body (workspaces in picker order,
// stages in workflow order limited to the ones that occur), the visible rows are the intersection of both selections,
// a workspace without a hit has no head, and an unreadable workspace is hidden only by the workspace selection.

function spec(id: string, stage: Stage): StatusSpec {
  return {
    id,
    slug: `${id}-item`,
    title: `Item ${id}`,
    stage,
    claims: { closed: 0, total: 1 },
    closedAt: null,
    state: null,
    archived: false,
    nextCommand: null,
  };
}

function ws(slug: string, specs: readonly StatusSpec[], readable = true): StatusWorkspace {
  return { slug, pathTail: `${slug}-tail`, readable, error: readable ? null : 'unreadable', specs };
}

// Picker order: harbor, atlas, quarry, broken (unreadable), empty (nothing listed).
const BODY: StatusResponse = {
  kpis: { repos: 5, listed: 7, claimsClosed: 0, claimsTotal: 7 },
  workspaces: [
    ws('harbor', [spec('001', 'done'), spec('002', 'build'), spec('003', 'plan')]),
    ws('atlas', [spec('010', 'review'), spec('011', 'build')]),
    ws('quarry', [spec('020', 'plan'), spec('021', 'review')]),
    ws('broken', [], false),
    ws('empty', []),
  ],
};

const filter = (workspaces: readonly string[], stages: readonly Stage[], active = false): WidgetFilter => ({ workspaces, stages, active });

/** Each visible group as `slug: id id …`, for readable comparisons. */
const shape = (f: WidgetFilter): readonly string[] =>
  visibleGroups(BODY, f).map((g) => `${g.slug}:${g.specs.map((s) => ` ${s.id}`).join('')}`);

describe('widget filter (spec 072, T17, ISC-603)', () => {
  it('lists the workspaces with a listed spec and every unreadable one, in picker order', () => {
    expect(workspaceOptions(BODY)).toEqual([
      { key: 'harbor', pathTail: 'harbor-tail', readable: true },
      { key: 'atlas', pathTail: 'atlas-tail', readable: true },
      { key: 'quarry', pathTail: 'quarry-tail', readable: true },
      { key: 'broken', pathTail: 'broken-tail', readable: false },
    ]);
  });

  it('lists only the occurring stages, in workflow order, never in order of first occurrence', () => {
    expect(stageOptions(BODY)).toEqual(['plan', 'review', 'build', 'done']);
  });

  it('takes its options from the unfiltered body, whatever is selected', () => {
    const narrowed = visibleGroups(BODY, filter(['atlas'], ['review']));
    expect(narrowed.map((g) => g.slug)).toEqual(['atlas']);
    expect(workspaceOptions(BODY).map((o) => o.key)).toEqual(['harbor', 'atlas', 'quarry', 'broken']);
  });

  it('shows everything with the empty filter, the unreadable workspace included, the empty one left out', () => {
    expect(EMPTY_FILTER).toEqual({ workspaces: [], stages: [], active: false });
    expect(shape(EMPTY_FILTER)).toEqual(['harbor: 001 002 003', 'atlas: 010 011', 'quarry: 020 021', 'broken:']);
  });

  it('narrows to the selected workspaces only', () => {
    expect(shape(filter(['quarry', 'harbor'], []))).toEqual(['harbor: 001 002 003', 'quarry: 020 021']);
  });

  it('narrows to the selected stages only and drops every readable workspace without a hit', () => {
    expect(shape(filter([], ['review']))).toEqual(['atlas: 010', 'quarry: 021', 'broken:']);
    expect(shape(filter([], ['done', 'plan']))).toEqual(['harbor: 001 003', 'quarry: 020', 'broken:']);
  });

  it('shows the intersection of both selections, heads only with a hit', () => {
    expect(shape(filter(['harbor', 'atlas'], ['build']))).toEqual(['harbor: 002', 'atlas: 011']);
    expect(shape(filter(['harbor', 'quarry'], ['review']))).toEqual(['quarry: 021']);
    expect(shape(filter(['atlas'], ['plan']))).toEqual([]);
  });

  it('hides the unreadable workspace only through the workspace selection, never through a stage selection', () => {
    expect(shape(filter([], ['build'])).at(-1)).toBe('broken:');
    expect(shape(filter(['broken'], []))).toEqual(['broken:']);
    expect(shape(filter(['broken'], ['done']))).toEqual(['broken:']);
    expect(shape(filter(['broken', 'atlas'], ['build']))).toEqual(['atlas: 011', 'broken:']);
    expect(shape(filter(['harbor'], [])).some((g) => g.startsWith('broken'))).toBe(false);
  });
});

// Spec 072 (T27, ISC-606): the selection survives a reload through `localStorage` and a live update through
// `pruneFilter`; a selected option that no longer occurs falls out, and a missing, unreadable or throwing store starts
// the filter without a selection.

/** A `Storage` over a map. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial));
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key: string) => items.get(key) ?? null,
    key: (index: number) => [...items.keys()][index] ?? null,
    removeItem: (key: string) => items.delete(key),
    setItem: (key: string, value: string) => items.set(key, value),
  };
}

/** A window over the given store; `'throws'` makes the `localStorage` accessor itself throw, as in a blocked window. */
function fakeWindow(storage: Storage | 'throws' = fakeStorage()): Window {
  const target = {} as Record<string, unknown>;
  Object.defineProperty(target, 'localStorage', {
    get: () => {
      if (storage === 'throws') throw new DOMException('denied', 'SecurityError');
      return storage;
    },
  });
  return target as unknown as Window;
}

const stored = (value: string): Window => fakeWindow(fakeStorage({ [WIDGET_FILTER_KEY]: value }));

describe('widget filter storage (spec 072, T27, ISC-606)', () => {
  it('uses the key next to the window bounds', () => {
    expect(WIDGET_FILTER_KEY).toBe('spectant.statusWidget.filter');
  });

  it('round-trips a selection through save and load, as after a reload', () => {
    const win = fakeWindow();
    saveWidgetFilter(filter(['atlas', 'broken'], ['review', 'done']), win);
    expect(JSON.parse(win.localStorage.getItem(WIDGET_FILTER_KEY) ?? 'null')).toEqual({
      workspaces: ['atlas', 'broken'],
      stages: ['review', 'done'],
      active: false,
    });
    expect(loadWidgetFilter(win)).toEqual(filter(['atlas', 'broken'], ['review', 'done']));
  });

  it('starts without a selection when nothing is stored', () => {
    expect(loadWidgetFilter(fakeWindow())).toEqual(EMPTY_FILTER);
  });

  it('starts without a selection when the stored value does not parse', () => {
    expect(loadWidgetFilter(stored('{not json'))).toEqual(EMPTY_FILTER);
    expect(loadWidgetFilter(stored(''))).toEqual(EMPTY_FILTER);
  });

  it.each([
    ['null', 'null'],
    ['a number', '42'],
    ['an array', '[]'],
    ['missing lists', '{}'],
    ['a string for workspaces', '{"workspaces":"atlas","stages":[]}'],
    ['an object for stages', '{"workspaces":[],"stages":{"0":"plan"}}'],
    ['a non-string workspace', '{"workspaces":["atlas",7],"stages":[]}'],
    ['a non-string stage', '{"workspaces":[],"stages":[null]}'],
    ['an unknown stage word', '{"workspaces":[],"stages":["shipping"]}'],
  ])('starts without a selection when the stored value has %s', (_label, value) => {
    expect(loadWidgetFilter(stored(value))).toEqual(EMPTY_FILTER);
  });

  it('starts without a selection when the localStorage accessor throws', () => {
    expect(loadWidgetFilter(fakeWindow('throws'))).toEqual(EMPTY_FILTER);
  });

  it('starts without a selection when getItem throws', () => {
    const storage = fakeStorage();
    storage.getItem = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    expect(loadWidgetFilter(fakeWindow(storage))).toEqual(EMPTY_FILTER);
  });

  it('swallows a throwing setItem and a throwing accessor on save', () => {
    const full = fakeStorage();
    full.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    expect(() => saveWidgetFilter(filter(['atlas'], ['plan']), fakeWindow(full))).not.toThrow();
    expect(() => saveWidgetFilter(filter(['atlas'], ['plan']), fakeWindow('throws'))).not.toThrow();
  });
});

describe('widget filter pruning on live updates (spec 072, T27, ISC-606)', () => {
  it('keeps the selection when a new spec appears', () => {
    const selected = filter(['atlas', 'broken'], ['review']);
    const grown: StatusResponse = {
      ...BODY,
      workspaces: BODY.workspaces.map((w) => (w.slug === 'atlas' ? ws('atlas', [...w.specs, spec('012', 'tasks')]) : w)),
    };
    expect(pruneFilter(selected, grown)).toBe(selected);
  });

  it('drops a selected workspace that vanished and a stage nobody has anymore', () => {
    const selected = filter(['harbor', 'atlas', 'quarry'], ['plan', 'done', 'build']);
    // harbor disappears (with the only `done`), quarry lists nothing anymore; atlas stays.
    const shrunk: StatusResponse = {
      ...BODY,
      workspaces: [ws('atlas', [spec('010', 'review'), spec('011', 'build')]), ws('quarry', []), ws('broken', [], false)],
    };
    expect(pruneFilter(selected, shrunk)).toEqual(filter(['atlas'], ['build']));
  });

  it('keeps an unreadable workspace, which still has a group, in the selection', () => {
    const selected = filter(['broken'], []);
    expect(pruneFilter(selected, BODY)).toBe(selected);
  });

  it('returns the same object when nothing changed, the empty filter included', () => {
    const selected = filter(['harbor', 'quarry'], ['plan', 'review']);
    expect(pruneFilter(selected, BODY)).toBe(selected);
    expect(pruneFilter(EMPTY_FILTER, BODY)).toBe(EMPTY_FILTER);
  });
});

// Spec 072 (T21, ISC-611): each chip counts the listed specs its option would show under the other dimension's
// selection, never its own; a 0 stays a real entry, and an unreadable workspace has no number.
describe('widget filter facet counts (spec 072, T21, ISC-611)', () => {
  /** A count map as a plain record. */
  const record = (counts: ReadonlyMap<string, number>): Record<string, number> => Object.fromEntries(counts);

  const ALL_WORKSPACES = { harbor: 3, atlas: 2, quarry: 2 };
  const ALL_STAGES = { plan: 2, review: 2, build: 2, done: 1 };

  it('counts every listed spec per option without a selection, the unreadable workspace without a number', () => {
    expect(record(workspaceCounts(BODY, EMPTY_FILTER))).toEqual(ALL_WORKSPACES);
    expect(record(stageCounts(BODY, EMPTY_FILTER))).toEqual(ALL_STAGES);
    expect(workspaceCounts(BODY, EMPTY_FILTER).has('broken')).toBe(false);
    expect(workspaceCounts(BODY, EMPTY_FILTER).has('empty')).toBe(false);
  });

  it('keeps the counts in option order', () => {
    expect([...workspaceCounts(BODY, EMPTY_FILTER).keys()]).toEqual(['harbor', 'atlas', 'quarry']);
    expect([...stageCounts(BODY, EMPTY_FILTER).keys()]).toEqual(stageOptions(BODY));
  });

  it('narrows the stage counts by a workspace selection and leaves the workspace counts as they are', () => {
    const f = filter(['atlas'], []);
    expect(record(stageCounts(BODY, f))).toEqual({ plan: 0, review: 1, build: 1, done: 0 });
    expect(record(workspaceCounts(BODY, f))).toEqual(ALL_WORKSPACES);
  });

  it('narrows the workspace counts by a stage selection and leaves the stage counts as they are', () => {
    const f = filter([], ['done']);
    expect(record(workspaceCounts(BODY, f))).toEqual({ harbor: 1, atlas: 0, quarry: 0 });
    expect(record(stageCounts(BODY, f))).toEqual(ALL_STAGES);
  });

  it('counts each dimension under the other one only when both are selected', () => {
    const f = filter(['harbor', 'quarry'], ['plan']);
    expect(record(workspaceCounts(BODY, f))).toEqual({ harbor: 1, atlas: 0, quarry: 1 });
    expect(record(stageCounts(BODY, f))).toEqual({ plan: 2, review: 1, build: 1, done: 1 });
  });

  it('keeps a 0 as a real entry, so the option stays visible and selectable', () => {
    const counts = stageCounts(BODY, filter(['atlas'], []));
    expect(counts.get('plan')).toBe(0);
    expect(counts.get('done')).toBe(0);
    expect(counts.size).toBe(stageOptions(BODY).length);
    expect(workspaceCounts(BODY, filter([], ['done'])).size).toBe(3);
  });

  it('gives an unreadable workspace no number, and a selected unreadable workspace contributes no stage hit', () => {
    expect(workspaceCounts(BODY, filter(['broken'], ['plan'])).has('broken')).toBe(false);
    expect(record(stageCounts(BODY, filter(['broken'], [])))).toEqual({ plan: 0, review: 0, build: 0, done: 0 });
  });

  it('never changes the counts of the dimension that is pressed', () => {
    for (const workspaces of [[], ['harbor'], ['atlas', 'quarry'], ['broken']]) {
      expect(record(workspaceCounts(BODY, filter(workspaces, ['review'])))).toEqual({ harbor: 0, atlas: 1, quarry: 1 });
    }
    const stageSelections: ReadonlyArray<readonly Stage[]> = [[], ['plan'], ['build', 'done']];
    for (const stages of stageSelections) {
      expect(record(stageCounts(BODY, filter(['harbor'], stages)))).toEqual({ plan: 1, review: 0, build: 1, done: 1 });
    }
  });
});

// Spec 075 (C1, ISC-630 to ISC-633): "Active" is a pseudo-option of the stage dimension, the specs with an open agent
// run (item state `running`). Its count honours the workspace selection only; selected, it narrows the list to the
// running rows, intersected with the stage and workspace selections; it survives a prune and a reload, and a stored
// filter in the old two-list shape loads with it off.
describe('widget filter "Active" option (spec 075, C1, ISC-630 to ISC-633)', () => {
  const running = (s: StatusSpec): StatusSpec => ({ ...s, state: 'running' });
  /** harbor: 002 build running, 003 plan idle; atlas: 010 review running, 011 build idle; quarry: nothing running. */
  const RUN: StatusResponse = {
    ...BODY,
    workspaces: [
      ws('harbor', [spec('001', 'done'), running(spec('002', 'build')), spec('003', 'plan')]),
      ws('atlas', [running(spec('010', 'review')), spec('011', 'build')]),
      ws('quarry', [spec('020', 'plan'), spec('021', 'review')]),
      ws('broken', [], false),
      ws('empty', []),
    ],
  };
  const ONE: StatusResponse = { ...BODY, workspaces: BODY.workspaces.map((w) => (w.slug === 'quarry' ? ws('quarry', [running(spec('020', 'plan')), spec('021', 'review')]) : w)) };
  const shapeOf = (body: StatusResponse, f: WidgetFilter): readonly string[] =>
    visibleGroups(body, f).map((g) => `${g.slug}:${g.specs.map((s) => ` ${s.id}`).join('')}`);
  const record = (counts: ReadonlyMap<string, number>): Record<string, number> => Object.fromEntries(counts);

  it('ISC-630: counts the running specs, 0, 1 and 2, under the workspace selection, never under the stage selection', () => {
    expect(activeCount(BODY, EMPTY_FILTER)).toBe(0);
    expect(activeCount(ONE, EMPTY_FILTER)).toBe(1);
    expect(activeCount(RUN, EMPTY_FILTER)).toBe(2);
    expect(activeCount(RUN, filter(['atlas'], []))).toBe(1);
    expect(activeCount(RUN, filter(['quarry', 'broken'], []))).toBe(0);
    expect(activeCount(RUN, filter([], ['plan']))).toBe(2);
    expect(activeCount(RUN, filter([], ['done'], true))).toBe(2);
    expect(activeCount(RUN, filter(['harbor'], ['review'], true))).toBe(1);
  });

  it('ISC-630: leaves the stage options and their counts untouched by "Active" (same dimension, ISC-611 held)', () => {
    expect(stageOptions(RUN)).toEqual(['plan', 'review', 'build', 'done']);
    expect(record(stageCounts(RUN, filter([], [], true)))).toEqual(record(stageCounts(RUN, EMPTY_FILTER)));
    expect(record(stageCounts(RUN, filter(['atlas'], [], true)))).toEqual({ plan: 0, review: 1, build: 1, done: 0 });
  });

  it('ISC-631: shows exactly the running rows alone, with a stage, with a workspace and with both selections', () => {
    expect(shapeOf(RUN, filter([], [], true))).toEqual(['harbor: 002', 'atlas: 010', 'broken:']);
    expect(shapeOf(RUN, filter([], ['build'], true))).toEqual(['harbor: 002', 'broken:']);
    expect(shapeOf(RUN, filter(['atlas'], [], true))).toEqual(['atlas: 010']);
    expect(shapeOf(RUN, filter(['atlas', 'quarry'], ['review', 'plan'], true))).toEqual(['atlas: 010']);
    expect(shapeOf(BODY, filter([], [], true))).toEqual(['broken:']);
    expect(shapeOf(ONE, filter([], [], true))).toEqual(['quarry: 020', 'broken:']);
  });

  it('ISC-631: narrows the workspace counts to the running rows that pass the stage selection', () => {
    expect(record(workspaceCounts(RUN, filter([], [], true)))).toEqual({ harbor: 1, atlas: 1, quarry: 0 });
    expect(record(workspaceCounts(RUN, filter(['harbor'], ['build'], true)))).toEqual({ harbor: 1, atlas: 0, quarry: 0 });
  });

  it('ISC-632: never shows an idle row with "Active", and a stage beside it narrows instead of adding', () => {
    // atlas 011 (build) is idle beside harbor 002 (build), running.
    const rows = (f: WidgetFilter): readonly StatusSpec[] => visibleGroups(RUN, f).flatMap((g) => g.specs);
    for (const stages of [[], ['build'], ['review'], ['plan', 'done'], ['build', 'review']] as ReadonlyArray<readonly Stage[]>) {
      const shown = rows(filter([], stages, true));
      expect(shown.every((s) => s.state === 'running')).toBe(true);
      expect(shown.length).toBeLessThanOrEqual(rows(filter([], [], true)).length);
    }
    expect(rows(filter([], ['build'], true)).map((s) => s.id)).toEqual(['002']);
    expect(rows(filter([], ['plan'], true))).toEqual([]);
  });

  it('ISC-633: never prunes "Active", even when no spec runs', () => {
    const selected = filter([], [], true);
    expect(pruneFilter(selected, BODY)).toBe(selected);
    expect(pruneFilter(filter(['gone'], [], true), BODY)).toEqual(filter([], [], true));
  });

  it('ISC-633: stores "Active", loads it back, and loads a stored filter of the old shape with "Active" off', () => {
    const win = fakeWindow();
    saveWidgetFilter(filter(['atlas'], ['build'], true), win);
    expect(JSON.parse(win.localStorage.getItem(WIDGET_FILTER_KEY) ?? 'null')).toEqual({ workspaces: ['atlas'], stages: ['build'], active: true });
    expect(loadWidgetFilter(win)).toEqual(filter(['atlas'], ['build'], true));
    expect(loadWidgetFilter(stored('{"workspaces":["atlas"],"stages":["plan"]}'))).toEqual(filter(['atlas'], ['plan']));
    expect(loadWidgetFilter(stored('{"workspaces":[],"stages":[],"active":"yes"}'))).toEqual(EMPTY_FILTER);
    expect(loadWidgetFilter(fakeWindow('throws'))).toEqual(EMPTY_FILTER);
  });
});
