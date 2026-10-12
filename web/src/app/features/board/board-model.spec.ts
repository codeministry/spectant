import type { PlanningModel } from '../../../../../core/src/planning';
import { allowedTransition, reasonOf, storyStep } from '../../../../../core/src/stage';
import dashboard from '../../../../../core/fixtures/harbor.golden.json';
import planningGolden from '../../../../../core/fixtures/harbor.planning.golden.json';
import {
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

describe('the board query (ISC-129.1)', () => {
  const FULL: BoardQueryState = {
    feature: ['F6', 'F2'],
    milestone: ['Harbor 1.0', 'none'],
    type: ['spike', 'idea'],
    assignee: [PERSON, 'unassigned'],
    group: 'milestone',
    col: 'close-pending',
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
