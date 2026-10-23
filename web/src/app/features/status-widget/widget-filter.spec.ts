import type { Stage } from '../../../../../core/src/stage';
import type { StatusResponse, StatusSpec, StatusWorkspace } from '../../../../../server/src/contracts/status.contract';
import { EMPTY_FILTER, stageOptions, visibleGroups, workspaceOptions, type WidgetFilter } from './widget-filter';

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
