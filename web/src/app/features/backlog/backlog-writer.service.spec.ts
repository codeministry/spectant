import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import backlogGolden from '../../../../../core/fixtures/backlog-ranks.planning.golden.json';
import type { BacklogEvent } from '../../../../../core/src/backlog';
import { ApiClient, type BacklogOp, type PlanningBody, type WriteResult } from '../../core/api.service';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { featureOrder } from '../../core/model/feature-order';
import { BACKLOG_WRITE_TIMEOUT, BacklogWriter } from './backlog-writer.service';

// T17 / T18 · ISC-195, ISC-196: the one backlog write of the tree and the board. A move and a priority send the hash
// of the last read, the held move stands until the answer, a second write for the same feature meanwhile sends
// nothing, a 200's hash is the next write's even before the planning tree reloaded, and the accepted change shows at
// once as an overlay that a 409 or 422 never leaves behind. The goldens are typed as JSON; the served body is the core type.

const H0 = '0'.repeat(64);
const H1 = '1'.repeat(64);
const H2 = '2'.repeat(64);
const MODEL = { ...(backlogGolden as unknown as PlanningBody), backlogHash: H0 };
const EVENT = {} as BacklogEvent;

type Result = WriteResult<'backlog'>;
const written = (hash: string): Result => ({ kind: 'answer', answer: { status: 200, body: { hash, event: EVENT } } });
const refused: Result = { kind: 'answer', answer: { status: 422, body: { error: 'backlog-refused', reason: 'another milestone' } } };
const stale = { kind: 'answer', answer: { status: 409, body: { error: 'stale', current: { backlog: H2 } } } } as unknown as Result;

interface Call {
  readonly ws: string;
  readonly op: BacklogOp;
  readonly hash: string;
  readonly answer: (result: Result) => void;
}

let calls: Call[];
let reloads: number;
let model: ReturnType<typeof signal<PlanningBody | null>>;
let writer: BacklogWriter;

function setup(served: PlanningBody | null = MODEL, timeout?: number): void {
  calls = [];
  reloads = 0;
  model = signal<PlanningBody | null>(served);
  const api: Pick<ApiClient, 'backlog'> = {
    backlog: (ws, op, hash) => new Promise<Result>((answer) => calls.push({ ws, op, hash, answer })),
  };
  const data = { planningModel: model.asReadonly(), planning: { reload: () => (reloads++, true) } };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: ShellData, useValue: data },
      { provide: ShellState, useValue: { ws: signal('ferry').asReadonly() } },
      ...(timeout === undefined ? [] : [{ provide: BACKLOG_WRITE_TIMEOUT, useValue: timeout }]),
    ],
  });
  writer = TestBed.inject(BacklogWriter);
}

/** The ids of the first milestone (Ferry 1.0: F2 before F1) as the writer's model shows them. */
const ferry1 = (): readonly string[] => {
  const shown = writer.model();
  return shown === null ? [] : (featureOrder(shown)[0]?.ids ?? []);
};
const priorityShown = (id: string): string | undefined => writer.model()?.features.find((f) => f.id === id)?.priority;

describe('backlog writer (T17, T18, ISC-195, ISC-196)', () => {
  it('a move sends the model hash and the move op, and is pending until the answer', async () => {
    setup();
    const outcome = writer.move('ferry', 'F1', 'F2');
    expect(calls).toEqual([expect.objectContaining({ ws: 'ferry', op: { op: 'move', feature: 'F1', before: 'F2' }, hash: H0 })]);
    expect(writer.pending('F1')).toBe(true);
    expect(writer.pending('F2')).toBe(false);
    expect(writer.held().get('F1')).toEqual({ op: 'move', feature: 'F1', before: 'F2' });
    calls[0]?.answer(written(H1));
    expect(await outcome).toBe('written');
    expect(writer.pending('F1')).toBe(false);
  });

  it('a priority sends the model hash and the priority op through the same flow', async () => {
    setup();
    const outcome = writer.priority('ferry', 'F1', 'P1');
    expect(calls).toEqual([expect.objectContaining({ op: { op: 'priority', feature: 'F1', priority: 'P1' }, hash: H0 })]);
    expect(writer.pending('F1')).toBe(true);
    calls[0]?.answer(written(H1));
    expect(await outcome).toBe('written');
    expect(writer.pending('F1')).toBe(false);
  });

  it('sends nothing for a second write of the same feature while the first is pending', async () => {
    setup();
    const first = writer.move('ferry', 'F1', 'F2');
    expect(await writer.priority('ferry', 'F1', 'P2')).toBe('error');
    expect(await writer.move('ferry', 'F1', null)).toBe('error');
    expect(calls.length).toBe(1);
    calls[0]?.answer(written(H1));
    await first;
  });

  it('sends nothing for another feature either while a write is pending, and is busy until the answer', async () => {
    setup();
    const first = writer.move('ferry', 'F1', 'F2');
    expect(writer.busy()).toBe(true);
    expect(await writer.priority('ferry', 'F3', 'P2')).toBe('error');
    expect(calls.length).toBe(1);
    calls[0]?.answer(written(H1));
    await first;
    expect(writer.busy()).toBe(false);
  });

  it('sends nothing without a model or without its hash', async () => {
    setup(null);
    expect(await writer.move('ferry', 'F1', 'F2')).toBe('error');
    model.set({ ...MODEL, backlogHash: undefined });
    expect(await writer.priority('ferry', 'F1', 'P1')).toBe('error');
    expect(calls.length).toBe(0);
  });

  it('after a 200 the next write sends the written hash before the model reloaded, then the reloaded one', async () => {
    setup();
    const first = writer.move('ferry', 'F1', 'F2');
    calls[0]?.answer(written(H1));
    await first;
    const second = writer.priority('ferry', 'F1', 'P1');
    expect(calls[1]?.hash).toBe(H1);
    calls[1]?.answer(written(H2));
    await second;
    model.set({ ...MODEL, backlogHash: H2 });
    void writer.priority('ferry', 'F2', 'P4');
    expect(calls[2]?.hash).toBe(H2);
  });

  it('reloads the planning tree after a 200, a 409, a 422 and an error', async () => {
    setup();
    const answers: Result[] = [written(H1), stale, refused, { kind: 'error', status: 0 }];
    const outcomes: string[] = [];
    for (const answer of answers) {
      model.set({ ...MODEL });
      const outcome = writer.priority('ferry', 'F1', 'P2');
      calls.at(-1)?.answer(answer);
      outcomes.push(await outcome);
    }
    expect(outcomes).toEqual(['written', 'stale', 'refused', 'error']);
    expect(reloads).toBe(4);
  });

  it('shows the accepted move and priority at once, until the reloaded model carries the written hash', async () => {
    setup();
    expect(ferry1()).toEqual(['F2', 'F1']);
    const move = writer.move('ferry', 'F1', 'F2');
    expect(ferry1()).toEqual(['F2', 'F1']); // the held move is the view's to draw, not the overlay's
    calls[0]?.answer(written(H1));
    await move;
    expect(ferry1()).toEqual(['F1', 'F2']);
    const priority = writer.priority('ferry', 'F1', 'P1');
    calls[1]?.answer(written(H2));
    await priority;
    expect(priorityShown('F1')).toBe('P1');
    expect(ferry1()).toEqual(['F1', 'F2']);
    // The reloaded tree is the truth again: once it carries the written hash, the overlay is inert.
    model.set({ ...MODEL, backlogHash: H2 });
    expect(ferry1()).toEqual(['F2', 'F1']);
    expect(priorityShown('F1')).toBe('P3');
  });

  it('moves to the end of the milestone with before null and leaves other milestones alone', async () => {
    setup();
    const move = writer.move('ferry', 'F2', null);
    calls[0]?.answer(written(H1));
    await move;
    const shown = writer.model();
    expect(shown && featureOrder(shown).map((g) => g.ids)).toEqual([['F1', 'F2'], ['F3', 'F4'], ['F0']]);
  });

  it('leaves nothing anticipated after a 409 or a 422: the overlay of that feature is gone', async () => {
    for (const answer of [stale, refused]) {
      TestBed.resetTestingModule();
      setup();
      const first = writer.move('ferry', 'F1', 'F2');
      calls[0]?.answer(written(H1));
      await first;
      expect(ferry1()).toEqual(['F1', 'F2']);
      const second = writer.priority('ferry', 'F1', 'P1');
      calls[1]?.answer(answer);
      await second;
      expect(ferry1()).toEqual(['F2', 'F1']);
      expect(priorityShown('F1')).toBe('P3');
      expect(writer.pending('F1')).toBe(false);
    }
  });
});

// T19 · ISC-198: a write that is not accepted leaves a refusal for its feature, with the tone's kind: core's phrase
// verbatim on a 422 (fail), `stale` on a 409 (warning), `failed` with the status on any other answer, no answer, or a
// write that has not answered within the timeout. Every one re-reads the planning tree and keeps nothing anticipated.
// The ✕ (`dismiss`) and the next write of that feature close it; a write of another feature leaves it standing.
describe('backlog writer refusal (T19, T20, ISC-198)', () => {
  it("a 422 keeps core's phrase verbatim for the feature, re-reads and anticipates nothing", async () => {
    setup();
    const outcome = writer.priority('ferry', 'F1', 'P1');
    calls[0]?.answer(refused);
    expect(await outcome).toBe('refused');
    expect(writer.refusalOf('F1')).toEqual({ op: 'priority', feature: 'F1', priority: 'P1', kind: 'refused', reason: 'another milestone' });
    expect(writer.refusalOf('F2')).toBeNull();
    expect(writer.refusals().size).toBe(1);
    expect(reloads).toBe(1);
    expect(priorityShown('F1')).toBe('P3');
    expect(writer.pending('F1')).toBe(false);
  });

  it('a 409 keeps a stale refusal for the moved feature, re-reads and keeps the served order', async () => {
    setup();
    const outcome = writer.move('ferry', 'F1', 'F2');
    calls[0]?.answer(stale);
    expect(await outcome).toBe('stale');
    expect(writer.refusalOf('F1')).toEqual({ op: 'move', feature: 'F1', priority: null, kind: 'stale' });
    expect(reloads).toBe(1);
    expect(ferry1()).toEqual(['F2', 'F1']);
  });

  it('no answer and any other status settle as failed with the status, like a refusal', async () => {
    setup();
    const first = writer.move('ferry', 'F1', 'F2');
    calls[0]?.answer({ kind: 'error', status: 0 });
    expect(await first).toBe('error');
    expect(writer.refusalOf('F1')).toEqual({ op: 'move', feature: 'F1', priority: null, kind: 'failed', status: 0 });
    const second = writer.priority('ferry', 'F3', 'P2');
    calls[1]?.answer({ kind: 'error', status: 500 });
    expect(await second).toBe('error');
    expect(writer.refusalOf('F3')).toEqual({ op: 'priority', feature: 'F3', priority: 'P2', kind: 'failed', status: 500 });
    expect(reloads).toBe(2);
  });

  it('a write without an answer within the timeout settles as failed with status 0 and frees the held row', async () => {
    setup(MODEL, 20);
    const outcome = writer.move('ferry', 'F1', 'F2');
    expect(writer.pending('F1')).toBe(true);
    expect(await outcome).toBe('error');
    expect(writer.refusalOf('F1')).toEqual({ op: 'move', feature: 'F1', priority: null, kind: 'failed', status: 0 });
    expect(writer.pending('F1')).toBe(false);
    expect(writer.busy()).toBe(false);
    expect(reloads).toBe(1);
    // The late answer changes nothing shown: no overlay, the refusal stands, the tree re-reads once more.
    calls[0]?.answer(written(H1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ferry1()).toEqual(['F2', 'F1']);
    expect(writer.refusalOf('F1')?.kind).toBe('failed');
    expect(reloads).toBe(2);
  });

  it("the ✕ and the next write of the feature close its refusal; another feature's write and a 200 leave none behind", async () => {
    setup();
    const first = writer.move('ferry', 'F1', 'F2');
    calls[0]?.answer(refused);
    await first;
    const other = writer.priority('ferry', 'F3', 'P1');
    expect(writer.refusalOf('F1')?.kind).toBe('refused');
    calls[1]?.answer(written(H1));
    await other;
    expect(writer.refusalOf('F3')).toBeNull();
    expect(writer.refusalOf('F1')?.kind).toBe('refused');
    writer.dismiss('F1');
    expect(writer.refusalOf('F1')).toBeNull();
    const again = writer.move('ferry', 'F1', 'F2');
    calls[2]?.answer(stale);
    await again;
    expect(writer.refusalOf('F1')?.kind).toBe('stale');
    const next = writer.move('ferry', 'F1', null);
    expect(writer.refusalOf('F1')).toBeNull();
    calls[3]?.answer(written(H2));
    await next;
    expect(writer.refusalOf('F1')).toBeNull();
  });
});
