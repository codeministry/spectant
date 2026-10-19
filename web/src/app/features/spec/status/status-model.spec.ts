import type { ActorMapping } from '../../../../../../server/src/spec-routes.contract';
import type { ClaimView, SpecHead, SpecPageModel, Workflow } from '../../../../../../core/src/files';
import dashboardGolden from '../../../../../../core/fixtures/harbor.golden.json';
import planningGolden from '../../../../../../core/fixtures/harbor.planning.golden.json';
import specGolden from '../../../../../../core/fixtures/harbor.spec.golden.json';
import { openClaims, stageSourceOf, statusAssignee, statusReason, statusTrack } from './status-model';

const claim = (id: string, state: ClaimView['state']): ClaimView =>
  ({ id, state, text: id, feature: null, kind: 'normal', edges: [], blockedBy: [], probe: null, verification: null, lock: null, dropped: null, noteCount: 0, line: 1 }) satisfies ClaimView;

const SPECS = specGolden as unknown as Record<string, SpecPageModel>;
const spec = (key: string): SpecPageModel => {
  const found = SPECS[`specs/${key}`] as SpecPageModel | undefined;
  if (!found) throw new Error(`harbor.spec.golden.json holds no ${key}`);
  return found;
};
const WORKFLOW = planningGolden.workflow as unknown as Workflow;
const ROWS = (dashboardGolden as unknown as { specs: ReadonlyArray<{ slug: string; nextReason: string }> }).specs;
const ACTORS: readonly ActorMapping[] = [{ id: 'u:3f9c0a7d', displayName: 'Harbour Master', gitIdentities: [] }];

describe('openClaims', () => {
  it('drops closed and dropped claims and keeps the order', () => {
    const claims = [claim('ISC-1', 'closed'), claim('ISC-2', 'takeable'), claim('ISC-3', 'dropped'), claim('ISC-4', 'blocked'), claim('ISC-5', 'open')];
    expect(openClaims(claims).map((c) => c.id)).toEqual(['ISC-2', 'ISC-4', 'ISC-5']);
  });
});

describe('statusTrack (T132, ISC-122.3)', () => {
  it('draws the type row of the workflow with the explicit stage current (002, feature, build)', () => {
    expect(statusTrack(spec('002-web-console').head, WORKFLOW)).toEqual({
      stages: ['plan', 'review', 'tasks', 'build', 'code-review', 'close', 'done'],
      stage: 'build',
      detour: null,
    });
  });

  it('puts close-pending as a marker on the stage it waits to enter (008, spike)', () => {
    expect(statusTrack(spec('008-referrers-support').head, WORKFLOW)).toEqual({
      stages: ['review', 'build', 'code-review', 'close', 'done'],
      stage: 'code-review',
      detour: 'close-pending',
    });
  });

  it('reads done on the last segment of a short row (007, chore)', () => {
    expect(statusTrack(spec('007-rotate-mirror-token').head, WORKFLOW)).toEqual({ stages: ['review', 'build', 'done'], stage: 'done', detour: null });
  });

  it('puts blocked on build, and close-pending on build where no stage follows it', () => {
    const head = spec('002-web-console').head;
    expect(statusTrack({ ...head, stage: 'blocked' }, WORKFLOW)).toMatchObject({ stage: 'build', detour: 'blocked' });
    const noReview: Workflow = { ...WORKFLOW, rows: [{ type: 'feature', stages: ['plan', 'build'], codeReview: 'feature' }] };
    expect(statusTrack({ ...head, stage: 'close-pending' }, noReview)).toMatchObject({ stage: 'build', detour: 'close-pending' });
  });

  it('falls back to the default row of the type before the planning tree answers', () => {
    const head: SpecHead = { ...spec('006-partial-push').head };
    expect(statusTrack(head, null)).toEqual({ stages: ['review', 'build', 'code-review', 'close', 'done'], stage: 'review', detour: null });
  });
});

describe('statusReason (T132, ISC-122.3)', () => {
  it('is the first reason, equal to the head and the dashboard row, with the next command (002)', () => {
    const m = spec('002-web-console');
    const reason = statusReason(m.head, m.next);
    expect(reason).toEqual({ phrase: 'ISC-74, ISC-75 and 2 more are takeable', command: '/spec implement 002' });
    expect(reason?.phrase).toBe(m.head.nextReason);
    expect(reason?.phrase).toBe(ROWS.find((row) => row.slug === m.head.slug)?.nextReason);
  });

  it('carries no command on close-pending (008)', () => {
    const m = spec('008-referrers-support');
    expect(statusReason(m.head, m.next)).toEqual({ phrase: 'every claim is closed and F6 waits on spec 009', command: null });
    expect(statusReason(m.head, { ...m.next, command: '/spec 008' })?.command).toBeNull();
  });

  it('is absent on a done spec, which has nothing to wait for (007)', () => {
    const m = spec('007-rotate-mirror-token');
    expect(statusReason(m.head, m.next)).toBeNull();
  });
});

describe('stageSourceOf (T132)', () => {
  it('reads explicit and derived from the head as core set it', () => {
    expect(stageSourceOf(spec('002-web-console').head)).toBe('explicit');
    expect(stageSourceOf(spec('008-referrers-support').head)).toBe('derived');
    expect(stageSourceOf(spec('007-rotate-mirror-token').head)).toBe('derived');
    expect(stageSourceOf({})).toBeNull();
  });
});

describe('statusAssignee (T133, ISC-131)', () => {
  it('maps a person to the stored display name (002)', () => {
    const assignee = statusAssignee(spec('002-web-console').head, ACTORS);
    expect(assignee?.actor.id).toBe('u:3f9c0a7d');
    expect(assignee?.name).toBe('Harbour Master');
  });

  it('keeps an unmapped person without a name, so the chip shows the raw id (008)', () => {
    expect(statusAssignee(spec('008-referrers-support').head, [])).toEqual({ actor: spec('008-referrers-support').head.assignee, name: null });
  });

  it('is null when nobody is assigned (003, 007)', () => {
    expect(statusAssignee(spec('003-config-loader').head, ACTORS)).toBeNull();
    expect(statusAssignee(spec('007-rotate-mirror-token').head, ACTORS)).toBeNull();
  });

  it('never names an agent from the person table', () => {
    const head = { ...spec('002-web-console').head, assignee: { raw: 'a:claude:sess-2', kind: 'agent' as const, id: 'a:claude:sess-2', legacy: false } };
    expect(statusAssignee(head, [{ id: 'a:claude:sess-2', displayName: 'x', gitIdentities: [] }])?.name).toBeNull();
  });
});
