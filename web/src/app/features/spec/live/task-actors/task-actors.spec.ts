import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import live from '../../../../../../../core/fixtures/harbor.live.golden.json';
import { parseActor } from '../../../../../../../core/src/actor';
import type { LiveCard, LiveFrame } from '../../../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../../../i18n/catalogues';
import { elapsedLabel, staleAgeLabel, taskActorsOf } from '../live-frame';
import { TaskActors } from './task-actors';

const LIVE = live['specs/002-web-console'] as unknown as LiveFrame;
const T27 = LIVE.cards.find((c) => c.task === 'T27') as LiveCard;

/** A synthetic running card worked by a sub-agent of a synthetic session, 50 minutes in. */
function withSubagent(stale: boolean): LiveCard {
  return {
    ...T27,
    task: 'T4',
    lock: { source: 'activity', session: 'a:claude:sess-9/T4' },
    since: new Date(Date.now() - 50 * 60_000).toISOString(),
    elapsedMs: 50 * 60_000,
    stale,
    agent: parseActor('a:claude:sess-9'),
    subagent: parseActor('a:claude:sess-9/T4'),
  };
}

describe('taskActorsOf / staleAgeLabel', () => {
  it('reads the agent of the harbor golden T27, no sub-agent, stale with its since', () => {
    expect(taskActorsOf(T27)).toEqual({ agent: T27.agent, subagent: null, since: T27.since, elapsedMs: T27.elapsedMs, stale: true });
  });

  it('is null for a card without agent and sub-agent (every free card of the golden)', () => {
    const free = LIVE.cards.filter((c) => c.agent === null && c.subagent === null);
    expect(free.length).toBeGreaterThan(0);
    expect(free.every((c) => taskActorsOf(c) === null)).toBe(true);
  });

  it('formats the stale age as the live frame formats elapsed time, from since or else from elapsedMs', () => {
    const now = Date.parse('2026-03-08T15:00:00Z');
    const actors = taskActorsOf(T27);
    if (!actors) throw new Error('T27 has no agent');
    expect(staleAgeLabel(actors, now, 'en')).toBe(elapsedLabel(T27.since ?? '', now, 'en'));
    expect(staleAgeLabel({ ...actors, since: null }, now, 'de')).toBe('vor 54 Minuten');
    expect(staleAgeLabel({ ...actors, since: null, elapsedMs: null }, now, 'en')).toBeNull();
  });
});

describe('TaskActors', () => {
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

  async function render(card: LiveCard): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(TaskActors);
    fixture.componentRef.setInput('card', card);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders T27 of the harbor golden as one agent chip with the stale mark and its age, no sub-agent chip', async () => {
    const host = await render(T27);
    expect(host.querySelectorAll('ui-actor-chip')).toHaveLength(1);
    const agent = host.querySelector('ui-actor-chip[data-task-agent]');
    expect(agent?.getAttribute('data-kind')).toBe('agent');
    expect(agent?.querySelector('.chip-label')?.textContent.trim()).toBe('a:claude:sess-2');
    expect(agent?.hasAttribute('data-stale')).toBe(true);
    expect(agent?.querySelector('.stale')?.textContent).toContain(elapsedLabel(T27.since ?? '', Date.now(), 'en') ?? '-');
    expect(host.querySelector('[data-task-subagent]')).toBeNull();
    expect(host.getAttribute('data-task-actors')).toBe('T27');
  });

  it('renders a card with both: the parent agent plain, the sub-agent with its task suffix carrying the lock state', async () => {
    const host = await render(withSubagent(true));
    const agent = host.querySelector('ui-actor-chip[data-task-agent]');
    const sub = host.querySelector('ui-actor-chip[data-task-subagent]');
    expect(agent?.querySelector('.chip-label')?.textContent.trim()).toBe('a:claude:sess-9');
    expect(agent?.hasAttribute('data-stale')).toBe(false);
    expect(agent?.hasAttribute('data-active')).toBe(false);
    expect(sub?.getAttribute('data-kind')).toBe('subagent');
    expect(sub?.querySelector('.task')?.textContent.trim()).toBe('T4');
    expect(sub?.hasAttribute('data-stale')).toBe(true);
    expect(sub?.querySelector('.stale')?.textContent).toContain('50 minutes ago');
  });

  it('marks a fresh holder active, without the stale label', async () => {
    const host = await render(withSubagent(false));
    const sub = host.querySelector('ui-actor-chip[data-task-subagent]');
    expect(sub?.hasAttribute('data-active')).toBe(true);
    expect(sub?.hasAttribute('data-stale')).toBe(false);
    expect(sub?.querySelector('.stale')).toBeNull();
  });
});
