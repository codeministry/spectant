import { type PlanningModel, buildPlanning } from '../../../../../core/src/planning';
import { allowedTransition, reasonOf, storyStep } from '../../../../../core/src/stage';
import dashboard from '../../../../../core/fixtures/harbor.golden.json';
import planningGolden from '../../../../../core/fixtures/harbor.planning.golden.json';
import ranksGolden from '../../../../../core/fixtures/backlog-ranks.planning.golden.json';
import {
  type BoardBand,
  type BoardCard,
  type BoardModel,
  type BoardQueryState,
  type BoardRow,
  boardQueryParams,
  boardRowsOf,
  boardSummaryOf,
  boardQueryString,
  buildBoard,
  dropTargetsOf,
  EMPTY_BOARD_QUERY,
  hiddenColumnsOf,
  hiddenLanesOf,
  type OverflowColumn,
  parseBoardQuery,
} from './board-model';

// T120 · ISC-129: the workspace board's view model, derived from the harbor planning golden and the dashboard rows the
// server sends beside it. The goldens are typed as JSON; the served bodies are the core types they snapshot.
const PLANNING = planningGolden as unknown as PlanningModel;
const ROWS = dashboard.specs as unknown as readonly BoardRow[];
const PERSON = 'u:3f9c0a7d';

const board = (query: Partial<BoardQueryState> = {}, actors: ReadonlyArray<{ id: string; displayName: string }> = []): BoardModel =>
  buildBoard({ planning: PLANNING, rows: ROWS, actors, query: { ...EMPTY_BOARD_QUERY, ...query } });
const column = (model: BoardModel, stage: string) => model.columns.find((c) => c.stage === stage);
const ids = (cards: readonly BoardCard[] | undefined) => (cards ?? []).map((card) => card.id ?? card.slug);
const card = (model: BoardModel, key: string) => model.cards.find((c) => c.id === key || c.slug === key);

describe('buildBoard (T120, ISC-129)', () => {
  it('has one column per board stage, in the order of `stages`', () => {
    expect(board().columns.map((c) => c.stage)).toEqual(PLANNING.stages);
  });

  it('counts each column as `stageCounts` does, and holds exactly that many cards unfiltered', () => {
    const model = board();
    for (const c of model.columns) {
      expect(c.count).toBe(PLANNING.stageCounts[c.stage] ?? 0);
      expect(c.cards).toHaveLength(c.count);
    }
    expect(model.total).toBe(Object.values(PLANNING.stageCounts).reduce((n, v) => n + v, 0));
    expect(model.specs).toBe(dashboard.specs.length);
    expect(model.ideas).toBe(PLANNING.ideas.length);
    expect(model.shown).toBe(model.total);
  });

  it('puts 008 in close-pending with its row phrase and no command: it waits on a spec, not on you', () => {
    const model = board();
    const row = dashboard.specs.find((r) => r.id === '008');
    expect(ids(column(model, 'close-pending')?.cards)).toEqual(['008']);
    const c = card(model, '008');
    expect(c).toMatchObject({
      kind: 'spec',
      slug: '008-referrers-support',
      type: 'spike',
      stage: 'close-pending',
      feature: 'F6',
      featureName: 'Registry compatibility',
      reason: row?.nextReason,
      command: null,
      waiting: true,
      waitsOnYou: false,
    });
    expect(c?.reason).toBe('every claim is closed and F6 waits on spec 009');
    expect(c?.assignee?.id).toBe(PERSON);
  });

  it('puts the two stories in idea, each with the story phrase and its /spec new command', () => {
    const model = board();
    const idea = column(model, 'idea');
    expect(idea?.cards.map((c) => c.slug)).toEqual(['registry-webhooks', 'console-audit-log']);
    for (const story of PLANNING.ideas) {
      const c = card(model, story.slug);
      const step = storyStep(story.slug);
      expect(c).toMatchObject({
        kind: 'idea',
        id: null,
        type: story.type,
        title: story.title,
        priority: story.priority,
        stage: 'idea',
        feature: story.feature,
        milestone: story.milestone,
        reason: reasonOf(step),
        command: step.command,
        waiting: false,
        waitsOnYou: false,
        path: story.path,
      });
    }
  });

  it('orders a column by priority, specs before ideas, then by number', () => {
    expect(ids(column(board(), 'review')?.cards)).toEqual(['006', '005']);
    expect(ids(column(board(), 'build')?.cards)).toEqual(['002', '009']);
  });

  it('takes the main feature and the milestone of each spec from the planning tree', () => {
    const model = board();
    expect(card(model, '003')).toMatchObject({ feature: 'F3', milestone: 'Harbor 0.9' });
    expect(card(model, '002')).toMatchObject({ feature: 'F2', milestone: 'Harbor 1.0' });
    expect(card(model, '006')).toMatchObject({ feature: 'F0', milestone: null });
  });

  it('marks review, code-review and close cards with a command as waiting on you, and counts them per column', () => {
    const model = board();
    expect(model.cards.filter((c) => c.waitsOnYou).map((c) => c.id)).toEqual(['006', '005', '004']);
    expect(model.waitingOnYou).toBe(3);
    expect(column(model, 'review')?.waitingOnYou).toBe(2);
    expect(column(model, 'build')?.waitingOnYou).toBe(0);
  });

  it('gives each column its stub state: empty, or n cards of which k wait on you', () => {
    const model = board();
    expect(column(model, 'plan')?.stub).toEqual({ kind: 'empty', hidden: 0 });
    expect(column(model, 'review')?.stub).toEqual({ kind: 'cards', cards: 2, waitingOnYou: 2 });
    expect(column(model, 'close-pending')?.stub).toEqual({ kind: 'cards', cards: 1, waitingOnYou: 0 });
    expect(column(board({ type: ['bug'] }), 'build')?.stub).toEqual({ kind: 'empty', hidden: 2 });
  });

  it('resolves a mapped person to its display name and leaves an unmapped one without a name', () => {
    const named = board({}, [{ id: PERSON, displayName: 'Harbor maintainer' }]);
    expect(card(named, '002')).toMatchObject({ assigneeName: 'Harbor maintainer' });
    expect(card(board(), '002')?.assigneeName).toBeNull();
    expect(card(named, '004')).toMatchObject({ assignee: null, assigneeName: null });
  });

  describe('filters', () => {
    it('narrows to the main feature', () => {
      const model = board({ feature: ['F6'] });
      expect(model.columns.flatMap((c) => ids(c.cards))).toEqual(['009', '008']);
      expect(model.shown).toBe(2);
      expect(column(model, 'build')?.hidden).toBe(1);
    });

    it('narrows to ideas, to a spec type, and ORs the values of one key', () => {
      expect(board({ type: ['idea'] }).shown).toBe(2);
      expect(ids(column(board({ type: ['spike'] }), 'build')?.cards)).toEqual(['009']);
      expect(board({ type: ['spike', 'chore'] }).shown).toBe(4);
    });

    it('narrows to a milestone or to none', () => {
      const one = board({ milestone: ['Harbor 1.0'] });
      expect(one.columns.flatMap((c) => ids(c.cards)).sort()).toEqual(['002', '004', 'registry-webhooks']);
      const none = board({ milestone: ['none'] });
      expect(none.columns.flatMap((c) => ids(c.cards)).sort()).toEqual(['005', '006', '007', '008', '009']);
    });

    it('narrows to an assignee or to unassigned, and ANDs the keys', () => {
      expect(board({ assignee: [PERSON] }).columns.flatMap((c) => ids(c.cards)).sort()).toEqual(['002', '006', '008', '009']);
      expect(board({ assignee: ['unassigned'] }).shown).toBe(6);
      expect(board({ assignee: [PERSON], feature: ['F6'], type: ['spike'] }).shown).toBe(2);
      expect(board({ assignee: [PERSON], type: ['idea'] }).shown).toBe(0);
    });

    it('counts the active filters and lists the options the cards carry', () => {
      const model = board({ feature: ['F6'], type: ['idea', 'bug'] });
      expect(model.activeFilters).toBe(3);
      expect(model.options.features.map((f) => f.id)).toEqual(PLANNING.features.map((f) => f.id));
      expect(model.options.types).toEqual(['feature', 'refactor', 'bug', 'spike', 'chore', 'idea']);
      expect(model.options.milestones).toEqual(['Harbor 0.9', 'Harbor 1.0', 'Harbor 2.0']);
      expect(model.options.assignees.map((a) => a.ref.id)).toEqual([PERSON]);
    });
  });

  describe('swimlanes', () => {
    it('bands a column by feature in master order, with counts and the omitted count', () => {
      const build = column(board({ group: 'feature' }), 'build');
      expect(build?.bands.map((b) => [b.key, b.label, b.count])).toEqual([
        ['F2', 'Web console', 1],
        ['F6', 'Registry compatibility', 1],
      ]);
      expect(build?.bandsOmitted).toBe(PLANNING.features.length - 2);
    });

    it('bands a column by milestone in target order, unknown names after them and no milestone last', () => {
      const model = board({ group: 'milestone' });
      expect(column(model, 'idea')?.bands.map((b) => [b.key, b.count, b.target])).toEqual([
        ['Harbor 1.0', 1, '2026-05-14'],
        ['Harbor 2.0', 1, null],
      ]);
      expect(column(model, 'review')?.bands.map((b) => [b.key, b.label, b.count])).toEqual([[null, null, 2]]);
      expect(column(model, 'code-review')?.bands[0]).toMatchObject({ key: 'Harbor 1.0', state: 'upcoming' });
    });

    it('has no bands without a group', () => {
      expect(board().columns.every((c) => c.bands.length === 0)).toBe(true);
    });
  });

  describe('the visible column', () => {
    it('is ?col when it names a board stage, else build when it has cards, else the first non-empty column', () => {
      expect(board().current).toBe('build');
      expect(board({ col: 'done' }).current).toBe('done');
      expect(board({ type: ['idea'] }).current).toBe('idea');
      expect(board({ assignee: ['nobody'] }).current).toBe(PLANNING.stages[0]);
    });
  });

  describe('drop targets', () => {
    it('lists the columns the workflow allows from the card stage, by the card type', () => {
      const model = board();
      expect(card(model, '008')?.targets).toEqual(['code-review']);
      expect(card(model, '002')?.targets).toEqual(['blocked', 'code-review']);
      expect(card(model, '007')?.targets).toEqual([]);
      for (const c of model.cards.filter((x) => x.kind === 'spec' && x.type !== null)) {
        for (const stage of PLANNING.stages) {
          const allowed = c.type !== null && c.stage !== 'idea' && allowedTransition(c.stage, stage, c.type, PLANNING.workflow);
          expect(c.targets.includes(stage)).toBe(allowed);
        }
      }
    });

    it('lets an idea drop only on the first stage of its type', () => {
      const model = board();
      expect(card(model, 'console-audit-log')?.targets).toEqual(['plan']);
      const c = card(model, 'registry-webhooks');
      expect(c && dropTargetsOf(c, PLANNING.workflow, PLANNING.stages)).toEqual(['plan']);
    });
  });
});

// Spec 033 (ISC-186, ISC-186.1): a spec that holds no claim yet, such as an allocated story, carries the feature its
// isa_feature names on its card and stands in that feature's swimlane, never in the one without a feature.
describe('claimless specs (spec 033)', () => {
  const master = ['# Master', '', '## Features', '', '### F1 · Loader', 'Why: Loader matters.', '', '- [ ] ISC-1: One.', '', '### F2 · Board', 'Why: Board matters.', ''].join('\n');
  const spec = (feature: string, claims: string): string => ['---', 'task: "A spec"', `isa_feature: ${feature}`, '---', '', '# Spec', '', claims].join('\n');
  const planning = buildPlanning({
    master,
    specs: [
      { folder: '001-loader', texts: { spec: spec('F1', '- [ ] ISC-1: One.') } },
      { folder: '002-board', texts: { spec: spec('F2', '') } },
    ],
    archived: [],
    specStates: [
      { slug: '001-loader', stage: 'plan', stageSource: 'explicit' },
      { slug: '002-board', stage: 'plan', stageSource: 'explicit' },
    ],
  });

  it('claimless: the card carries its isa_feature and stands in that swimlane, not in the one without a feature', () => {
    const model = buildBoard({ planning, rows: [], query: { ...EMPTY_BOARD_QUERY, group: 'feature' } });
    expect(card(model, '002')).toMatchObject({ feature: 'F2', featureName: 'Board' });
    expect(column(model, 'plan')?.bands.map((b) => [b.key, b.count])).toEqual([
      ['F1', 1],
      ['F2', 1],
    ]);
  });
});

describe('folded columns (principal 2026-10-13)', () => {
  it('folds a column without a shown card, opens it on ?open=, folds a column with cards on ?fold=', () => {
    const base = board();
    const empty = base.columns.find((c) => c.cards.length === 0);
    const full = base.columns.find((c) => c.cards.length > 0);
    if (!empty || !full) throw new Error('harbor has an empty and a full column');
    expect(empty.folded).toBe(true);
    expect(full.folded).toBe(false);
    const toggled = board({ open: [empty.stage], fold: [full.stage] });
    expect(toggled.columns.find((c) => c.stage === empty.stage)?.folded).toBe(false);
    expect(toggled.columns.find((c) => c.stage === full.stage)?.folded).toBe(true);
  });

  it('writes open and fold after col, one repeated key per stage, and drops unknown stages', () => {
    const q = parseBoardQuery('open=blocked&open=nope&fold=idea&fold=idea');
    expect(q.open).toEqual(['blocked']);
    expect(q.fold).toEqual(['idea']);
    expect(boardQueryString({ ...EMPTY_BOARD_QUERY, col: 'build', open: ['blocked'], fold: ['idea'] })).toBe('col=build&open=blocked&fold=idea');
  });
});

describe('the board query (ISC-129.1)', () => {
  const FULL: BoardQueryState = {
    feature: ['F6', 'F2'],
    milestone: ['Harbor 1.0', 'none'],
    type: ['spike', 'idea'],
    assignee: [PERSON, 'unassigned'],
    group: 'milestone',
    col: 'close-pending',
    open: ['blocked'],
    fold: ['idea'],
  };

  it('parses a router query map, single values and repeated ones', () => {
    expect(parseBoardQuery({ feature: 'F6', type: ['spike', 'idea'], group: 'feature', col: 'build' })).toEqual({
      ...EMPTY_BOARD_QUERY,
      feature: ['F6'],
      type: ['spike', 'idea'],
      group: 'feature',
      col: 'build',
    });
  });

  it('drops what it does not know: an unknown type, group or column, blanks and repeats', () => {
    expect(parseBoardQuery({ type: ['spike', 'wrench', 'spike'], group: 'lane', col: 'shipping', feature: ['', 'F1'] })).toEqual({
      ...EMPTY_BOARD_QUERY,
      type: ['spike'],
      feature: ['F1'],
    });
    expect(parseBoardQuery({})).toEqual(EMPTY_BOARD_QUERY);
  });

  it('round-trips through the router params and through the stored query string', () => {
    expect(parseBoardQuery(boardQueryParams(FULL))).toEqual(FULL);
    expect(parseBoardQuery(boardQueryString(FULL))).toEqual(FULL);
    expect(boardQueryString(parseBoardQuery(boardQueryString(FULL)))).toBe(boardQueryString(FULL));
    expect(parseBoardQuery(new URLSearchParams(boardQueryString(FULL)))).toEqual(FULL);
  });

  it('serialises the defaults to nothing, and leaves a key out once it is cleared', () => {
    expect(boardQueryParams(EMPTY_BOARD_QUERY)).toEqual({});
    expect(boardQueryString(EMPTY_BOARD_QUERY)).toBe('');
    expect(boardQueryParams({ ...EMPTY_BOARD_QUERY, col: 'build' })).toEqual({ col: 'build' });
    expect(boardQueryString({ ...EMPTY_BOARD_QUERY, milestone: ['Harbor 1.0'], group: 'feature' })).toBe('milestone=Harbor+1.0&group=feature');
  });
});

describe('the board summary (T116, ISC-129)', () => {
  it('reads the active rows of a served dashboard body, and nothing from anything else', () => {
    expect(boardRowsOf(dashboard)).toEqual(ROWS);
    expect(boardRowsOf(null)).toEqual([]);
    expect(boardRowsOf({ specs: 'nope' })).toEqual([]);
    expect(boardRowsOf({ specs: [{ id: '002' }, 7, { id: '003', slug: '003-x' }] })).toEqual([{ id: '003', slug: '003-x' }]);
  });

  it('counts the columns, every card on the board and the cards that wait on you, unfiltered', () => {
    const summary = boardSummaryOf(board());
    expect(summary).toEqual({ stages: PLANNING.stages.length, cards: board().total, waiting: board().waitingOnYou });
    expect(summary.cards).toBe(Object.values(PLANNING.stageCounts).reduce((n, v) => n + v, 0));
    expect(summary.waiting).toBe(3);
    // A filtered model still summarises the whole board: the area menu line never follows the page's filters.
    expect(boardSummaryOf(board({ type: ['idea'] }))).toEqual(summary);
  });
});

describe('hidden columns at medium (spec 019, T29, ISC-141.1)', () => {
  /** The harbor board with feature swimlanes, as `?group=feature` renders it. */
  const lanes = (query: Partial<BoardQueryState> = {}): BoardModel => board({ group: 'feature', ...query });
  /** Every column from `build` on lies right of the scroller box, as at 820 px. */
  const RIGHT_OF_BUILD = new Set(PLANNING.stages.slice(PLANNING.stages.indexOf('build')));
  /** A column of `n` cards (per lane `bands`) without building a card: the overflow reads only the counts. */
  const col = (stage: OverflowColumn['stage'], bands: ReadonlyArray<readonly [string | null, number]>): OverflowColumn => ({
    stage,
    cards: { length: bands.reduce((n, [, count]) => n + count, 0) },
    bands: bands.map(([key, count]) => ({ key, count })),
  });

  describe('hiddenColumnsOf', () => {
    it('names every hidden column that holds cards, in column order, with its count', () => {
      expect(hiddenColumnsOf(lanes().columns, RIGHT_OF_BUILD)).toEqual([
        { stage: 'build', count: 2 },
        { stage: 'close-pending', count: 1 },
        { stage: 'code-review', count: 1 },
        { stage: 'done', count: 1 },
      ]);
    });

    it('leaves out an empty column or stub (blocked, close) and every column in view', () => {
      const stages = hiddenColumnsOf(lanes().columns, new Set(PLANNING.stages)).map((c) => c.stage);
      expect(stages).not.toContain('plan');
      expect(stages).not.toContain('blocked');
      expect(stages).not.toContain('close');
      expect(hiddenColumnsOf(lanes().columns, new Set())).toEqual([]);
      expect(hiddenColumnsOf(lanes().columns, new Set(['plan', 'blocked', 'close'] as const))).toEqual([]);
    });

    it('counts a folded column with cards (?fold=), and never an opened empty one (?open=)', () => {
      const model = lanes({ fold: ['done'], open: ['close'] });
      expect(hiddenColumnsOf(model.columns, new Set(['done', 'close'] as const))).toEqual([{ stage: 'done', count: 1 }]);
    });

    it('counts the cards the filters let through, and drops a column whose cards they all hide', () => {
      const model = lanes({ feature: ['F6'] });
      expect(hiddenColumnsOf(model.columns, RIGHT_OF_BUILD)).toEqual([
        { stage: 'build', count: 1 },
        { stage: 'close-pending', count: 1 },
      ]);
    });
  });

  describe('hiddenLanesOf', () => {
    it('gives every lane whose cards all lie in hidden columns its count and those columns', () => {
      const found = hiddenLanesOf(lanes().columns, RIGHT_OF_BUILD);
      expect([...found.keys()].sort()).toEqual(['F4', 'F5', 'F6']);
      expect(found.get('F6')).toEqual({
        key: 'F6',
        count: 2,
        columns: [
          { stage: 'build', count: 1 },
          { stage: 'close-pending', count: 1 },
        ],
      });
      expect(found.get('F4')).toEqual({ key: 'F4', count: 1, columns: [{ stage: 'code-review', count: 1 }] });
    });

    it('leaves out a lane with one card in view, however many it has out of view', () => {
      // F2 has a card in idea (in view) and one in build (hidden): the lane does not look empty.
      expect(hiddenLanesOf(lanes().columns, RIGHT_OF_BUILD).has('F2')).toBe(false);
      expect(hiddenLanesOf(lanes().columns, new Set()).size).toBe(0);
    });

    it('keys the band without a feature by null, and sums a lane over its hidden columns', () => {
      const columns = [col('idea', [['F1', 1]]), col('plan', []), col('build', [['F1', 1], [null, 2]]), col('done', [[null, 1]])];
      const found = hiddenLanesOf(columns, new Set(['plan', 'build', 'done'] as const));
      expect([...found.keys()]).toEqual([null]);
      expect(found.get(null)).toEqual({
        key: null,
        count: 3,
        columns: [
          { stage: 'build', count: 2 },
          { stage: 'done', count: 1 },
        ],
      });
      expect(hiddenColumnsOf(columns, new Set(['plan', 'build', 'done'] as const))).toEqual([
        { stage: 'build', count: 3 },
        { stage: 'done', count: 1 },
      ]);
    });

    it('is empty without swimlanes: a board without a group has no bands', () => {
      expect(hiddenLanesOf(board().columns, RIGHT_OF_BUILD).size).toBe(0);
    });
  });
});

// T11 · ISC-197 (spec 037): with feature swimlanes the bands follow `featureOrder` — milestone by milestone, each
// milestone's features in rank, then the "No milestone" group, the band without a feature last — and every feature
// band names the area it may move in. A divider heads each area only when the bands span more than one.
describe('feature lanes rank (spec 037, T11, ISC-197)', () => {
  const RANKS = ranksGolden as unknown as PlanningModel;
  /** backlog-ranks holds no spec: one story per feature, and one without, puts a card of each in the idea column. */
  const story = (feature: string | null): PlanningModel['ideas'][number] => ({
    slug: `story-${feature ?? 'none'}`,
    title: `Story of ${feature ?? 'no feature'}`,
    type: 'feature',
    feature,
    milestone: null,
    priority: 'P3',
    path: `specs/ideas/story-${feature ?? 'none'}.md`,
  });
  const ranked = (query: Partial<BoardQueryState> = {}): BoardModel =>
    buildBoard({
      planning: { ...RANKS, ideas: [null, 'F0', 'F1', 'F2', 'F3', 'F4'].map(story) },
      rows: [],
      query: { ...EMPTY_BOARD_QUERY, group: 'feature', ...query },
    });
  const lanes = (bands: ReadonlyArray<Pick<BoardBand, 'key' | 'moveGroup' | 'divider'>> | undefined) =>
    (bands ?? []).map((b) => [b.key, b.moveGroup, b.divider === null ? null : [b.divider.key, b.divider.name, b.divider.target]]);
  const FERRY_1 = ['milestone:ferry-1-0', 'Ferry 1.0', '2026-04-15'];
  const FERRY_2 = ['milestone:ferry-2-0', 'Ferry 2.0', '2026-06-30'];
  const GROUP = ['group', null, null];

  it('orders the bands by milestone and rank, then the "No milestone" group, and "No feature" last', () => {
    expect(lanes(column(ranked(), 'idea')?.bands)).toEqual([
      ['F2', 'milestone:ferry-1-0', FERRY_1],
      ['F1', 'milestone:ferry-1-0', null],
      ['F3', 'milestone:ferry-2-0', FERRY_2],
      ['F4', 'milestone:ferry-2-0', null],
      ['F0', 'group', GROUP],
      [null, null, null],
    ]);
  });

  it('orders the lanes across the board the same way', () => {
    expect(lanes(ranked().lanes)).toEqual(lanes(column(ranked(), 'idea')?.bands));
  });

  it('draws no divider when the shown bands lie in one milestone', () => {
    expect(lanes(column(ranked({ feature: ['F1', 'F2', 'none'] }), 'idea')?.bands)).toEqual([
      ['F2', 'milestone:ferry-1-0', null],
      ['F1', 'milestone:ferry-1-0', null],
      [null, null, null],
    ]);
  });

  it('follows the milestones a feature holds specs of where the master names none (harbor), not the global rank', () => {
    const model = board({ group: 'feature' });
    const H09 = ['milestone:harbor-0-9', 'Harbor 0.9', '2026-03-15'];
    const H10 = ['milestone:harbor-1-0', 'Harbor 1.0', '2026-05-14'];
    expect(lanes(column(model, 'review')?.bands)).toEqual([
      ['F3', 'milestone:harbor-0-9', H09],
      ['F0', 'group', GROUP],
    ]);
    expect(lanes(column(model, 'tasks')?.bands)).toEqual([['F3', 'milestone:harbor-0-9', null]]);
    expect(lanes(model.lanes)).toEqual([
      ['F3', 'milestone:harbor-0-9', H09],
      ['F2', 'milestone:harbor-1-0', H10],
      ['F4', 'milestone:harbor-1-0', null],
      ['F0', 'group', GROUP],
      ['F5', 'group', null],
      ['F6', 'group', null],
      ['F7', 'group', null],
    ]);
  });

  it('places a feature two milestones list once, under the first', () => {
    const [h09, h10] = PLANNING.milestones;
    const f2 = h10.features.find((share) => share.id === 'F2');
    if (f2 === undefined) throw new Error('harbor lists F2 under Harbor 1.0');
    const planning: PlanningModel = { ...PLANNING, milestones: [{ ...h09, features: [...h09.features, f2] }, h10] };
    const model = buildBoard({ planning, rows: ROWS, query: { ...EMPTY_BOARD_QUERY, group: 'feature' } });
    // F2 (rank 3) now ranks ahead of F3 (rank 4) inside Harbor 0.9 and is not repeated under Harbor 1.0.
    expect(model.lanes.map((lane) => [lane.key, lane.moveGroup])).toEqual([
      ['F2', 'milestone:harbor-0-9'],
      ['F3', 'milestone:harbor-0-9'],
      ['F4', 'milestone:harbor-1-0'],
      ['F0', 'group'],
      ['F5', 'group'],
      ['F6', 'group'],
      ['F7', 'group'],
    ]);
  });

  it('keeps milestone bands without a move group or divider', () => {
    const model = board({ group: 'milestone' });
    expect(model.columns.flatMap((c) => c.bands).every((b) => b.moveGroup === null && b.divider === null)).toBe(true);
    expect(model.lanes.map((lane) => lane.key)).toEqual(['Harbor 0.9', 'Harbor 1.0', 'Harbor 2.0', null]);
  });
});
