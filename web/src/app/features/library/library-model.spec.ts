import type { LibraryCatalog, LibraryDoc, SpecGroupHead } from '../../../../../core/src/files';
import {
  EVIDENCE_BLOCK,
  evidenceBlock,
  evidenceOpens,
  filterParams,
  fogGroups,
  highlight,
  type LibraryGroup,
  libraryGroups,
  matches,
  NO_FILTER,
  parseFilter,
  specFirst,
  specKey,
  specOptions,
  specScope,
  specSlug,
  typePills,
} from './library-model';

const doc = (path: string, over: Partial<LibraryDoc> = {}): LibraryDoc => {
  const spec = path.includes('/') ? (path.split('/')[0] ?? 'workspace') : 'workspace';
  return {
    path,
    type: 'spec',
    spec: spec === 'ideas' ? 'workspace' : spec,
    title: path,
    modified: '2026-10-12T14:02:00.000Z',
    state: 'ok',
    media: 'markdown',
    ...over,
  };
};

const head = (spec: string): SpecGroupHead => ({
  spec,
  type: 'feature',
  stage: 'plan',
  claimsClosed: 1,
  claimsTotal: 4,
  tasksDone: 0,
  tasksTotal: 3,
  fog: 0,
  goal: null,
  approach: null,
});

const catalog = (docs: readonly LibraryDoc[], over: Partial<LibraryCatalog> = {}): LibraryCatalog => ({
  docs,
  groups: [],
  fog: [],
  missing: docs.filter((entry) => entry.state === 'missing').length,
  stale: docs.filter((entry) => entry.state === 'stale').length,
  ...over,
});

/** The group at `at`, failing the test when there is none. */
const groupAt = (groups: readonly LibraryGroup[], at: number): LibraryGroup => {
  const group = groups.at(at);
  if (!group) throw new Error(`no group at ${String(at)}`);
  return group;
};

const evidence = (spec: string, n: number): LibraryDoc[] =>
  Array.from({ length: n }, (_, at) => doc(`${spec}/.evidence/shot-${String(at).padStart(4, '0')}.png`, { type: 'evidence', media: 'image' }));

describe('library model (spec 017, T26)', () => {
  describe('groups', () => {
    // Catalog order on purpose scrambled: 010 before 002, 002 split in two runs, workspace documents in between.
    const docs = [
      doc('010-later/spec.md'),
      doc('002-web-console/spec.md'),
      doc('tldr.md', { type: 'tldr' }),
      doc('002-web-console/plan.md', { type: 'plan', state: 'missing', modified: null }),
      doc('constitution.md', { type: 'constitution' }),
      doc('ideas/a.md', { type: 'idea' }),
      doc('tech.md', { type: 'tech' }),
      doc('002-web-console/design.md', { type: 'design', state: 'stale' }),
      doc('009-mid/spec.md'),
    ];
    const cat = catalog(docs, { groups: [head('002-web-console'), head('009-mid'), head('010-later')] });

    it('puts workspace-wide first, then the specs ascending, each spec exactly once', () => {
      const groups = libraryGroups(cat, NO_FILTER);
      expect(groups.map((group) => group.spec)).toEqual(['workspace', '002-web-console', '009-mid', '010-later']);
      expect(groups.map((group) => group.key)).toEqual(['workspace', '002', '009', '010']);
    });

    it('orders the workspace group constitution, tech, TL;DR, ideas', () => {
      const ws = groupAt(libraryGroups(cat, NO_FILTER), 0);
      expect(ws.docs.map((entry) => entry.type)).toEqual(['constitution', 'tech', 'tldr', 'idea']);
      expect(ws.head).toBeNull();
    });

    it('lists present documents before missing ones and carries the head', () => {
      const spec = groupAt(libraryGroups(cat, NO_FILTER), 1);
      expect(spec.docs.map((entry) => entry.path)).toEqual(['002-web-console/spec.md', '002-web-console/design.md', '002-web-console/plan.md']);
      expect(spec.head?.spec).toBe('002-web-console');
      expect(spec.count).toBe(3);
    });

    it('leaves a group without a match out and is empty under the filter "open"', () => {
      expect(libraryGroups(cat, { ...NO_FILTER, spec: '009' }).map((group) => group.spec)).toEqual(['009-mid']);
      expect(libraryGroups(cat, { ...NO_FILTER, state: 'open' })).toEqual([]);
    });
  });

  describe('evidence', () => {
    const docs = [doc('024-parity/spec.md'), ...evidence('024-parity', 120), doc('024-parity/artifacts/a.png', { type: 'artifact', media: 'image' })];
    const cat = catalog(docs);

    it('collapses a spec\'s evidence into one subgroup with its count, out of the rows', () => {
      const group = groupAt(libraryGroups(cat, NO_FILTER), 0);
      expect(group.docs.map((entry) => entry.type)).toEqual(['spec', 'artifact']);
      expect(group.evidence?.count).toBe(120);
      expect(group.evidence?.open).toBe(false);
      expect(group.count).toBe(122);
    });

    it('reveals the subgroup in blocks of 50', () => {
      const sub = groupAt(libraryGroups(cat, NO_FILTER), 0).evidence;
      if (!sub) throw new Error('no evidence subgroup');
      expect(EVIDENCE_BLOCK).toBe(50);
      expect(evidenceBlock(sub, 0)).toEqual({ shown: [], rest: 120 });
      expect(evidenceBlock(sub, 1).shown).toHaveLength(50);
      expect(evidenceBlock(sub, 2)).toMatchObject({ rest: 20 });
      expect(evidenceBlock(sub, 3)).toMatchObject({ rest: 0 });
      expect(evidenceBlock(sub, 3).shown).toHaveLength(120);
    });

    it('opens on a search or the type filter evidence, and only then', () => {
      expect(evidenceOpens(NO_FILTER)).toBe(false);
      expect(evidenceOpens({ ...NO_FILTER, query: '  ' })).toBe(false);
      expect(evidenceOpens({ ...NO_FILTER, query: 'shot' })).toBe(true);
      expect(evidenceOpens({ ...NO_FILTER, type: 'evidence' })).toBe(true);
      const typed = groupAt(libraryGroups(cat, { ...NO_FILTER, type: 'evidence' }), 0);
      expect(typed.docs).toEqual([]);
      expect(typed.evidence).toMatchObject({ count: 120, open: true });
      expect(groupAt(libraryGroups(cat, { ...NO_FILTER, query: 'shot-0001' }), 0).evidence).toMatchObject({ count: 1, open: true });
      expect(groupAt(libraryGroups(cat, { ...NO_FILTER, type: 'spec' }), 0).evidence).toBeNull();
    });
  });

  describe('type pills', () => {
    it('names only the types present, in pill order, never Decisions (context)', () => {
      const docs = [
        doc('ideas/x.md', { type: 'idea' }),
        doc('002-a/context.md', { type: 'context' }),
        ...evidence('002-a', 2),
        doc('002-a/spec.md'),
        doc('constitution.md', { type: 'constitution' }),
      ];
      expect(typePills(docs)).toEqual(['spec', 'evidence', 'constitution', 'idea']);
      expect(typePills([])).toEqual([]);
    });

    it('depends on the documents of the context, not on the matches', () => {
      const docs = [doc('002-a/spec.md'), doc('002-a/plan.md', { type: 'plan' })];
      const before = typePills(docs);
      libraryGroups(catalog(docs), { ...NO_FILTER, type: 'plan' });
      expect(typePills(docs)).toEqual(before);
    });
  });

  describe('filters', () => {
    const docs = [
      doc('002-a/spec.md', { title: 'Web console' }),
      doc('002-a/plan.md', { type: 'plan', state: 'missing', modified: null }),
      doc('003-b/design.md', { type: 'design', state: 'stale' }),
      doc('tech.md', { type: 'tech', title: 'Tech overview' }),
    ];

    it('narrows by type, spec (number or workspace) and state', () => {
      const paths = (filter: typeof NO_FILTER): string[] => docs.filter((entry) => matches(entry, filter)).map((entry) => entry.path);
      expect(paths({ ...NO_FILTER, type: 'plan' })).toEqual(['002-a/plan.md']);
      expect(paths({ ...NO_FILTER, spec: '002' })).toEqual(['002-a/spec.md', '002-a/plan.md']);
      expect(paths({ ...NO_FILTER, spec: 'workspace' })).toEqual(['tech.md']);
      expect(paths({ ...NO_FILTER, state: 'stale' })).toEqual(['003-b/design.md']);
      expect(paths({ ...NO_FILTER, state: 'missing' })).toEqual(['002-a/plan.md']);
      expect(paths({ ...NO_FILTER, state: 'open' })).toEqual([]);
    });

    it('matches a query on title or path ignoring case, or on a server hit', () => {
      const filter = { ...NO_FILTER, query: 'CONSOLE' };
      expect(docs.filter((entry) => matches(entry, filter)).map((entry) => entry.path)).toEqual(['002-a/spec.md']);
      const hits = new Map([['003-b/design.md', '… the console grid …']]);
      expect(docs.filter((entry) => matches(entry, filter, hits)).map((entry) => entry.path)).toEqual(['002-a/spec.md', '003-b/design.md']);
    });

    it('reads and writes the address, unknown values falling back to all', () => {
      const params = new URLSearchParams('q=etag&type=plan&spec=017&state=stale');
      const filter = parseFilter((name) => params.get(name));
      expect(filter).toEqual({ query: 'etag', type: 'plan', spec: '017', state: 'stale', archived: false });
      expect(filterParams(filter)).toEqual({ q: 'etag', type: 'plan', spec: '017', state: 'stale' });
      const odd = new URLSearchParams('type=notes&state=old&spec=');
      expect(parseFilter((name) => odd.get(name))).toEqual(NO_FILTER);
      expect(parseFilter((name) => new URLSearchParams('type=context').get(name)).type).toBe('all');
      expect(filterParams(NO_FILTER)).toEqual({});
    });

    it('reads ?archived=1 as on, anything else as off, and writes it only when on', () => {
      const on = parseFilter((name) => new URLSearchParams('archived=1&type=spec').get(name));
      expect(on).toEqual({ ...NO_FILTER, type: 'spec', archived: true });
      expect(filterParams(on)).toEqual({ type: 'spec', archived: '1' });
      expect(parseFilter((name) => new URLSearchParams('archived=yes').get(name)).archived).toBe(false);
    });

    it('leaves the archived specs\' documents out unless archived is on, and combines it with every other filter', () => {
      const docs = [doc('002-a/spec.md'), doc('002-a/plan.md', { type: 'plan' }), doc('archive/001-old/spec.md', { spec: '001-old', archived: true }), doc('archive/001-old/plan.md', { spec: '001-old', type: 'plan', archived: true })];
      const paths = (filter: typeof NO_FILTER): string[] => docs.filter((entry) => matches(entry, filter)).map((entry) => entry.path);
      expect(paths(NO_FILTER)).toEqual(['002-a/spec.md', '002-a/plan.md']);
      expect(paths({ ...NO_FILTER, archived: true })).toEqual(docs.map((entry) => entry.path));
      expect(paths({ ...NO_FILTER, archived: true, type: 'plan' })).toEqual(['002-a/plan.md', 'archive/001-old/plan.md']);
      expect(paths({ ...NO_FILTER, archived: true, spec: '001' })).toEqual(['archive/001-old/spec.md', 'archive/001-old/plan.md']);
      expect(paths({ ...NO_FILTER, spec: '001' })).toEqual([]);
      expect(paths({ ...NO_FILTER, archived: true, query: 'old/plan' })).toEqual(['archive/001-old/plan.md']);
      expect(paths({ ...NO_FILTER, archived: true, state: 'stale' })).toEqual([]);
    });

    it('offers workspace-wide first, then every spec ascending, once each', () => {
      const options = specOptions([doc('010-z/spec.md'), doc('002-a/spec.md'), doc('tech.md', { type: 'tech' }), doc('002-a/plan.md', { type: 'plan' })]);
      expect(options).toEqual([
        { value: 'workspace', spec: 'workspace' },
        { value: '002', spec: '002-a' },
        { value: '010', spec: '010-z' },
      ]);
      expect(specKey('017-workspace-library')).toBe('017');
      expect(specSlug('017-workspace-library')).toBe('workspace-library');
      expect(specKey('workspace')).toBe('workspace');
    });
  });

  describe('fog', () => {
    it('groups the open points by spec ascending, narrowed by spec and query', () => {
      const cat = catalog([], {
        fog: [
          { spec: '010-z', text: 'Which port?' },
          { spec: '002-a', text: 'Retry budget' },
          { spec: '010-z', text: 'Who owns `retry`?' },
        ],
      });
      expect(fogGroups(cat, { ...NO_FILTER, state: 'open' })).toEqual([
        { spec: '002-a', key: '002', lines: [{ spec: '002-a', text: 'Retry budget' }] },
        { spec: '010-z', key: '010', lines: [{ spec: '010-z', text: 'Which port?' }, { spec: '010-z', text: 'Who owns `retry`?' }] },
      ]);
      expect(fogGroups(cat, { ...NO_FILTER, state: 'open', spec: '010' }).map((group) => group.lines.length)).toEqual([2]);
      expect(fogGroups(cat, { ...NO_FILTER, state: 'open', query: 'RETRY' }).map((group) => group.spec)).toEqual(['002-a', '010-z']);
    });
  });

  describe('text', () => {
    it('highlights the first match', () => {
      expect(highlight('Approach & architecture', 'ARCH')).toEqual([
        { text: 'Approach & ', hit: false },
        { text: 'arch', hit: true },
        { text: 'itecture', hit: false },
      ]);
      expect(highlight('Plan', '')).toEqual([{ text: 'Plan', hit: false }]);
    });
  });
});

describe('the spec area scope (T46, ISC-158)', () => {
  const catalog: LibraryCatalog = {
    docs: [
      doc('constitution.md', { type: 'constitution' }),
      doc('tech.md', { type: 'tech' }),
      doc('ideas/webhooks.md', { type: 'idea' }),
      doc('002-web-console/spec.md'),
      doc('002-web-console/plan.md', { type: 'plan', state: 'stale' }),
      doc('002-web-console/tasks.md', { type: 'tasks', state: 'missing', modified: null }),
      doc('002-web-console/.evidence/run-001/probe.md', { type: 'evidence' }),
      doc('003-board/spec.md', { state: 'stale' }),
      doc('003-board/plan.md', { type: 'plan', state: 'missing', modified: null }),
      doc('1002-later/spec.md'),
    ],
    groups: [head('002-web-console'), head('003-board')],
    fog: [
      { spec: '002-web-console', text: 'Which width?' },
      { spec: '003-board', text: 'Which column?' },
    ],
    missing: 2,
    stale: 2,
  };

  it('keeps the spec’s documents, missing entries and evidence, plus the constitution, and counts the spec alone', () => {
    const scoped = specScope(catalog, '002');
    expect(scoped.docs.map((entry) => entry.path)).toEqual([
      '002-web-console/spec.md',
      '002-web-console/plan.md',
      '002-web-console/tasks.md',
      '002-web-console/.evidence/run-001/probe.md',
      'constitution.md',
    ]);
    expect(scoped.groups).toEqual([]);
    expect(scoped.fog).toEqual([{ spec: '002-web-console', text: 'Which width?' }]);
    expect({ missing: scoped.missing, stale: scoped.stale }).toEqual({ missing: 1, stale: 1 });
  });

  it('matches the spec by its whole number, never by a prefix', () => {
    expect(specScope(catalog, '1002').docs.map((entry) => entry.path)).toEqual(['1002-later/spec.md', 'constitution.md']);
    expect(specScope(catalog, '999').docs.map((entry) => entry.path)).toEqual(['constitution.md']);
  });

  it('resolves the route’s spec ref in the three forms the server accepts: number, folder and slug', () => {
    const byNumber = specScope(catalog, '002');
    for (const ref of ['002-web-console', 'web-console']) {
      const scoped = specScope(catalog, ref);
      expect(scoped.docs.map((entry) => entry.path)).toEqual(byNumber.docs.map((entry) => entry.path));
      expect(scoped.fog).toEqual(byNumber.fog);
      expect({ missing: scoped.missing, stale: scoped.stale }).toEqual({ missing: 1, stale: 1 });
    }
    expect(specScope(catalog, 'web').docs.map((entry) => entry.path)).toEqual(['constitution.md']);
  });

  it('puts the spec group first and the workspace-wide group after it', () => {
    const groups = specFirst(libraryGroups(specScope(catalog, '002'), NO_FILTER));
    expect(groups.map((group) => group.key)).toEqual(['002', 'workspace']);
    expect(groups[0]?.docs.map((entry) => entry.path)).toEqual(['002-web-console/spec.md', '002-web-console/plan.md', '002-web-console/tasks.md']);
    expect(groups[0]?.evidence?.count).toBe(1);
    expect(groups[0]?.head).toBeNull();
  });
});
