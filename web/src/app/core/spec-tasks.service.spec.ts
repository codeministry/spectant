import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import golden from '../../../../core/fixtures/harbor.tasks.golden.json';
import { ApiClient, type TaskCheckResult, type TasksResult } from './api.service';
import { SpecTasks } from './spec-tasks.service';
import type { SpecRouteResponses } from '../../../../server/src/contracts/spec-routes.contract';

type TasksBody = NonNullable<SpecRouteResponses['tasks']>;
const GOLDEN = golden['specs/002-web-console'] as unknown as TasksBody;

// Spec 067 (T32, ISC-535): the open tasks of one spec, loaded only when a host asks, with the Tasks tab's checkbox.
describe('SpecTasks', () => {
  let reads: string[];
  let sent: Array<{ ws: string; id: string; tid: string; hash: string; checked: boolean }>;

  function setUp(): SpecTasks {
    reads = [];
    sent = [];
    const api: Pick<ApiClient, 'tasks' | 'taskCheck'> = {
      tasks: (ws, id): Promise<TasksResult> => {
        reads.push(`${ws}/${id}`);
        return Promise.resolve({ kind: 'ok', body: GOLDEN, etag: null, notModified: false, hash: 'h0' });
      },
      taskCheck: (ws, id, tid, hash, checked): Promise<TaskCheckResult> => {
        sent.push({ ws, id, tid, hash, checked });
        const line = { number: 49, text: `- [${checked ? 'x' : ' '}] ${tid} · ISC-77 · operator — pass` };
        return Promise.resolve({ kind: 'ok', body: { task: tid, checked, hash: 'h1', lockSource: 'none', line } });
      },
    };
    TestBed.configureTestingModule({ providers: [SpecTasks, { provide: ApiClient, useValue: api }] });
    return TestBed.inject(SpecTasks);
  }
  const settle = () => TestBed.inject(ApplicationRef).whenStable();

  it('reads nothing until a spec is asked for, then its open tasks', async () => {
    const tasks = setUp();
    await settle();
    expect(reads).toEqual([]);
    expect(tasks.open()).toEqual([]);
    tasks.load('harbor', '002');
    await settle();
    expect(reads).toEqual(['harbor/002']);
    expect(tasks.open().map((row) => row.id)).toEqual(['T27', 'T28', 'T29', 'T31', 'T32']);
    expect(tasks.ofClaim('ISC-77').map((row) => row.id)).toEqual(GOLDEN.tasks.filter((row) => row.claim === 'ISC-77').map((row) => row.id));
    // The same spec again is no second read.
    tasks.load('harbor', '002');
    await settle();
    expect(reads).toEqual(['harbor/002']);
  });

  it('ticks one task through write path 2 with the read hash and shows it ticked in place, without a read', async () => {
    const tasks = setUp();
    tasks.load('harbor', '002');
    await settle();
    const t31 = tasks.open().find((row) => row.id === 'T31');
    if (t31 === undefined) throw new Error('T31 is open in the golden');
    const result = await tasks.tick(t31, true);
    expect(result?.kind).toBe('ok');
    expect(sent).toEqual([{ ws: 'harbor', id: '002', tid: 'T31', hash: 'h0', checked: true }]);
    expect(reads).toEqual(['harbor/002']);
    // The ticked row stays in the list of the read, ticked.
    const after = tasks.open().find((row) => row.id === 'T31');
    expect(after?.state).toBe('done');
    expect(tasks.checks.checked(t31)).toBe(true);
  });

  it('honours a connected lock on the row claim: the box is blocked and nothing is sent', async () => {
    const tasks = setUp();
    tasks.connectLock(signal({ claim: 'ISC-77', session: 'a:claude:s-1' }));
    tasks.load('harbor', '002');
    await settle();
    const t31 = tasks.open().find((row) => row.id === 'T31');
    if (t31 === undefined) throw new Error('T31 is open in the golden');
    expect(tasks.checks.line(t31)).toEqual({ kind: 'locked', session: 'a:claude:s-1' });
    expect(await tasks.tick(t31, true)).toBeNull();
    expect(sent).toEqual([]);
  });
});
