import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import frames from '../../../../../../../core/fixtures/harbor.frames.golden.json';
import live from '../../../../../../../core/fixtures/harbor.live.golden.json';
import type { Frame, LiveFrame } from '../../../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../../../i18n/catalogues';
import { frameEvents } from '../board/board-model';
import { AgentChip } from './agent-chip';
import { NeedsYou } from './needs-you';
import { ThisFrame } from './this-frame';

const LIVE = live['specs/002-web-console'] as unknown as LiveFrame;
const HISTORY = (frames['specs/002-web-console'] as unknown as Frame[]).at(-1) as Frame;

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
  });
});

async function render(type: typeof AgentChip | typeof ThisFrame | typeof NeedsYou, inputs: Record<string, unknown>): Promise<HTMLElement> {
  const fixture = TestBed.createComponent<unknown>(type);
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('AgentChip', () => {
  it('shows the session, a relative time over since and the stale marker only when stale', async () => {
    const since = new Date(Date.now() - 3 * 60_000 - 5_000).toISOString();
    const fresh = await render(AgentChip, { session: 'spec-002-ISC-75', since, stale: false });
    expect(fresh.querySelector('[data-agent-session]')?.textContent).toContain('spec-002-ISC-75');
    expect(fresh.querySelector('time[data-agent-elapsed]')?.getAttribute('datetime')).toBe(since);
    expect(fresh.querySelector('time[data-agent-elapsed]')?.textContent).toBe('3 minutes ago');
    expect(fresh.querySelector('[data-agent-stale]')).toBeNull();

    const stale = await render(AgentChip, { session: 'spec-002-ISC-74', since, stale: true });
    expect(stale.querySelector('[data-agent-stale]')?.textContent.trim()).toBe('stale');
  });
});

describe('ThisFrame', () => {
  it('lists the cards that changed since the previous frame, the lock source and the agents of the live frame', async () => {
    const events = frameEvents(HISTORY, LIVE);
    const root = await render(ThisFrame, { frame: LIVE, events });
    const rows = [...root.querySelectorAll('[data-frame-event]')].map((row) => row.getAttribute('data-frame-event'));
    expect(rows).toEqual(events.map((c) => c.task));
    expect(root.querySelector('[data-lock-source]')?.getAttribute('data-lock-source')).toBe(LIVE.lockSource);
    expect(root.querySelector('[data-lock-source]')?.textContent).toContain(LIVE.lockSource);
    expect(root.querySelectorAll('[data-agents] app-agent-chip').length).toBe(LIVE.agents.length);
  });

  it('names no lock source for a history frame and says when nothing changed', async () => {
    const root = await render(ThisFrame, { frame: HISTORY, events: [] });
    expect(root.querySelector('[data-lock-source]')).toBeNull();
    expect(root.textContent).toContain('Nothing changed in this frame.');
  });
});

describe('NeedsYou', () => {
  it('counts the model list, renders each card with a 4 px edge row and raises the stale-agent alert', async () => {
    const root = await render(NeedsYou, { frame: LIVE, cards: LIVE.needsYou });
    expect(root.querySelector('[data-needs-count]')?.textContent.trim()).toBe(String(LIVE.needsYou.length));
    const cards = [...root.querySelectorAll('[data-needs-card]')].map((c) => c.getAttribute('data-needs-card'));
    expect(cards).toEqual(LIVE.needsYou.map((c) => c.task));
    const stale = LIVE.agents.filter((a) => a.stale);
    expect(root.querySelectorAll('[data-stale-agent]').length).toBe(stale.length);
    for (const agent of stale) expect(root.querySelector('[data-stale-agent]')?.textContent).toContain(agent.session);
  });
});
