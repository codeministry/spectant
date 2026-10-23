import type { Stage } from '../../../../../core/src/stage';
import type { StatusResponse, StatusSpec, StatusWorkspace } from '../../../../../server/src/contracts/status.contract';
import {
  EMPTY_FILTER,
  loadWidgetFilter,
  pruneFilter,
  saveWidgetFilter,
  stageOptions,
  visibleGroups,
  WIDGET_FILTER_KEY,
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
  kpis: { repos: 5, closed: 1, listed: 7, claimsClosed: 0, claimsTotal: 7 },
  workspaces: [
    ws('harbor', [spec('001', 'done'), spec('002', 'build'), spec('003', 'plan')]),
    ws('atlas', [spec('010', 'review'), spec('011', 'build')]),
    ws('quarry', [spec('020', 'plan'), spec('021', 'review')]),
    ws('broken', [], false),
    ws('empty', []),
  ],
};

const filter = (workspaces: readonly string[], stages: readonly Stage[]): WidgetFilter => ({ workspaces, stages });

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
    expect(EMPTY_FILTER).toEqual({ workspaces: [], stages: [] });
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
