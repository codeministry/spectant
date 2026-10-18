import { TestBed } from '@angular/core/testing';
import { EVENTS_PATH, LIVE_EVENT, type LiveUpdate } from '../../../../server/src/spec-routes.contract';
import { EVENT_SOURCE, LiveStreamService } from './live-stream.service';

/** An `EventSource` the test drives: it records every instance and dispatches what the server would send. */
class FakeEventSource extends EventTarget {
  static readonly instances: FakeEventSource[] = [];
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readyState = 0;
  closed = 0;

  constructor(readonly url: string) {
    super();
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed += 1;
    this.readyState = this.CLOSED;
  }

  open(): void {
    this.readyState = this.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  /** A dropped stream: the browser reconnects on its own, so the state is CONNECTING again. */
  fail(): void {
    this.readyState = this.CONNECTING;
    this.dispatchEvent(new Event('error'));
  }

  emit(type: string, data: string): void {
    this.dispatchEvent(new MessageEvent(type, { data }));
  }
}

const update: LiveUpdate = {
  ws: 'harbor',
  views: [{ path: '/api/workspaces/harbor/dashboard', etag: 'W/"abc"', body: { kpis: { claims: { closed: 3 } } } }],
};

/** The one stream the service opened; fails the test on any other count. */
const theSource = (): FakeEventSource => {
  expect(FakeEventSource.instances).toHaveLength(1);
  return FakeEventSource.instances[0];
};

describe('LiveStreamService', () => {
  let service: LiveStreamService;

  beforeEach(() => {
    FakeEventSource.instances.length = 0;
    TestBed.configureTestingModule({ providers: [{ provide: EVENT_SOURCE, useValue: FakeEventSource }] });
    service = TestBed.inject(LiveStreamService);
  });

  it('opens one stream on the events path and starts disconnected, with no update', () => {
    expect(theSource().url).toBe(EVENTS_PATH);
    expect(EVENTS_PATH).toBe('/api/events');
    expect(service.connected()).toBe(false);
    expect(service.updates()).toBeNull();
  });

  it('follows open and error in connected()', () => {
    const source = theSource();
    source.open();
    expect(service.connected()).toBe(true);
    source.fail();
    expect(service.connected()).toBe(false);
    source.open();
    expect(service.connected()).toBe(true);
  });

  it('delivers an update frame as a LiveUpdate, each frame a new value', () => {
    const source = theSource();
    source.open();
    source.emit(LIVE_EVENT, JSON.stringify(update));
    const first = service.updates();
    expect(first).toEqual(update);

    source.emit(LIVE_EVENT, JSON.stringify(update));
    expect(service.updates()).toEqual(update);
    expect(service.updates()).not.toBe(first);
  });

  it('drops invalid JSON and payloads that fail isLiveUpdate, keeping the last good update', () => {
    const source = theSource();
    source.open();
    for (const data of ['{nope', '', 'null', '[]', JSON.stringify({ ws: 1, views: [] }), JSON.stringify({ ws: 'harbor' })]) {
      source.emit(LIVE_EVENT, data);
    }
    expect(service.updates()).toBeNull();

    source.emit(LIVE_EVENT, JSON.stringify(update));
    const good = service.updates();
    source.emit(LIVE_EVENT, JSON.stringify({ ws: 'harbor', views: [{ path: '/elsewhere', etag: 'x', body: null }] }));
    source.emit(LIVE_EVENT, JSON.stringify({ ...update, extra: true }));
    expect(service.updates()).toBe(good);
    expect(service.connected()).toBe(true);
  });

  it('listens only for the update event name, not unnamed messages', () => {
    const source = theSource();
    source.emit('message', JSON.stringify(update));
    expect(service.updates()).toBeNull();
  });

  it('closes the stream when the injector is destroyed', () => {
    const source = theSource();
    source.open();
    expect(source.closed).toBe(0);
    TestBed.resetTestingModule();
    expect(source.closed).toBe(1);
  });
});

describe('LiveStreamService without EventSource', () => {
  it('stays disconnected and opens nothing', () => {
    FakeEventSource.instances.length = 0;
    TestBed.configureTestingModule({ providers: [{ provide: EVENT_SOURCE, useValue: null }] });
    const service = TestBed.inject(LiveStreamService);
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(service.connected()).toBe(false);
    expect(service.updates()).toBeNull();
  });
});
