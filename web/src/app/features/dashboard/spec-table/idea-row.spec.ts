import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { ApiClient } from '../../../core/api.service';
import { LockSourceService } from '../../../core/lock-source.service';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { ToastService } from '../../../shared/ui/toast/toast';
import type { DashboardIdea } from './idea-rows';
import { IdeaRow } from './idea-row';

/** A story as `DashboardModel.ideas.list` serves it: placed, prioritised and open with its command. */
const IDEA: DashboardIdea = {
  slug: 'offline-sync',
  title: 'Offline sync',
  feature: 'F3',
  milestone: 'M2',
  priority: 'P2',
  state: { kind: 'idea', id: 'offline-sync', state: 'open', stage: 'idea', command: '/spec new offline-sync', reason: 'Shape it.' },
};

/** The idea favourite writes the real `ShellData` sends, each answering the set as the server stores it. */
const writes: string[] = [];
let stored: string[] = [];
const favoriteWrites = {
  favorites: () => Promise.resolve({ kind: 'ok', body: { specs: [], ideas: [...stored] }, etag: null, notModified: false }),
  putIdeaFavorite: (ws: string, slug: string) => {
    writes.push(`PUT ${ws} ${slug}`);
    stored = [...stored, slug];
    return Promise.resolve({ kind: 'ok', body: { specs: [], ideas: [...stored] } });
  },
  deleteIdeaFavorite: (ws: string, slug: string) => {
    writes.push(`DELETE ${ws} ${slug}`);
    stored = stored.filter((entry) => entry !== slug);
    return Promise.resolve({ kind: 'ok', body: { specs: [], ideas: [...stored] } });
  },
};
/** Every other read the shell's resources make is the catch-all 404. */
const api = new Proxy(favoriteWrites, {
  get: (target, key: string) => (target as Record<string, unknown>)[key] ?? (() => Promise.resolve({ kind: 'not-found', served: false })),
});

beforeEach(() => {
  writes.length = 0;
  stored = [];
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [
      provideRouter([]),
      { provide: ApiClient, useValue: api },
      { provide: ShellState, useValue: { ws: signal('harbor'), wsPage: signal(null), specId: signal(null) } },
      { provide: ToastService, useValue: { show: () => undefined } },
      { provide: LockSourceService, useValue: { connect: () => undefined } },
    ],
  });
});

async function render(idea: DashboardIdea, lang: 'en' | 'de' = 'en'): Promise<HTMLElement> {
  TestBed.inject(TranslocoService).setActiveLang(lang);
  const fixture = TestBed.createComponent(IdeaRow);
  fixture.componentRef.setInput('idea', idea);
  fixture.componentRef.setInput('ws', 'harbor');
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('IdeaRow (spec 064, T40, ISC-479, ISC-482)', () => {
  it('renders the idea glyph, title, feature, milestone, priority and state', async () => {
    const row = await render(IDEA);
    expect(row.querySelector('.rid ui-icon')).not.toBeNull();
    expect(row.querySelector('[data-idea-title]')?.textContent.trim()).toBe('Offline sync');
    expect(row.querySelector('[data-idea-where]')?.textContent.trim()).toBe('F3 · M2');
    expect(row.querySelector('ui-priority')?.getAttribute('data-level')).toBe('P2');
    expect(row.querySelector('ui-item-state')?.getAttribute('data-state')).toBe('open');
  });

  // Spec 064 (T47, ISC-488): the idea row fills the spec row's named columns, each cell rendered even when empty.
  it('puts each part in the spec row\'s column: glyph in id, title and meta in title, priority in prio, state in phase (T47)', async () => {
    const row = await render(IDEA);
    const cell = (name: string) => row.querySelector<HTMLElement>(`:scope > [data-cell="${name}"]`);
    expect([...row.children].map((child) => child.getAttribute('data-cell'))).toEqual(['id', 'title', 'more', 'mark', 'agent', 'prio', 'track', 'phase', 'meter', 'star']);
    expect(cell('id')?.querySelector('ui-icon')).not.toBeNull();
    expect(cell('title')?.querySelector('[data-idea-title]')).not.toBeNull();
    expect(cell('title')?.querySelector('[data-idea-where]')?.textContent.trim()).toBe('F3 · M2');
    expect(cell('prio')?.querySelector('ui-priority')).not.toBeNull();
    expect(cell('phase')?.querySelector('ui-item-state')).not.toBeNull();
    expect(cell('phase')?.querySelector('ui-command-chip')).toBeNull();
    for (const empty of ['more', 'mark', 'agent', 'track', 'meter']) expect(cell(empty)?.children.length).toBe(0);
    expect(cell('star')?.querySelector('button[ui-star-toggle]')).not.toBeNull();
    expect(row.querySelector('.rtrack ui-priority, .rtrack ui-item-state')).toBeNull();
  });

  it('leaves out feature, milestone and state the story does not name', async () => {
    const row = await render({ ...IDEA, feature: null, milestone: 'M2', state: undefined });
    expect(row.querySelector('[data-idea-where]')?.textContent.trim()).toBe('M2');
    expect(row.querySelector('ui-item-state')).toBeNull();
    const bare = await render({ ...IDEA, feature: null, milestone: null, state: undefined });
    expect(bare.querySelector('[data-idea-where]')).toBeNull();
  });

  it('is one link to the idea page, named by the idea', async () => {
    const row = await render(IDEA);
    const links = row.querySelectorAll('a');
    expect(links.length).toBe(1);
    expect(links[0].getAttribute('href')).toBe('/w/harbor/ideas/offline-sync');
    expect(links[0].getAttribute('aria-label')).toBe('Idea Offline sync');
    const de = await render(IDEA, 'de');
    expect(de.querySelector('a')?.getAttribute('aria-label')).toBe('Idee Offline sync');
  });

  it('carries no spec trait: no stage track, progress, command chip or agent dot (ISC-482)', async () => {
    const running: DashboardIdea = {
      ...IDEA,
      state: {
        kind: 'idea',
        id: 'offline-sync',
        state: 'running',
        stage: 'idea',
        run: { run: 'r1', command: '/spec new offline-sync', session: 's1', actor: { kind: 'agent', id: 'a:claude:s1' } as never, since: '2026-10-21T08:00:00Z', elapsedMs: 60_000, openRuns: 1, source: 'run' },
      },
    };
    for (const idea of [IDEA, running]) {
      const row = await render(idea);
      expect(row.querySelector('ui-stage-track')).toBeNull();
      expect(row.querySelector('ui-meter, .rmeter [role="img"], .frac')).toBeNull();
      expect(row.querySelector('ui-command-chip')).toBeNull();
      expect(row.querySelector('ui-agent-dot, ui-actor-chip')).toBeNull();
      expect(row.querySelector('ui-item-state')).not.toBeNull();
    }
  });
});

describe('IdeaRow star (spec 064, T53, ISC-497)', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('carries its own star beside the row link, named by the idea, unpressed without a favourite', async () => {
    const row = await render(IDEA);
    const star = row.querySelector<HTMLButtonElement>(':scope > [data-cell="star"] > button[ui-star-toggle]');
    expect(star).not.toBeNull();
    expect(star?.closest('a')).toBeNull();
    expect(star?.getAttribute('aria-pressed')).toBe('false');
    expect(star?.getAttribute('aria-label')).toBe('Favorite: idea Offline sync');
    const de = await render(IDEA, 'de');
    expect(de.querySelector('button[ui-star-toggle]')?.getAttribute('aria-label')).toBe('Favorit: Idee Offline sync');
  });

  it('sets, then unsets the idea favourite through the client, without selecting the row or navigating', async () => {
    const router = TestBed.inject(Router);
    const row = await render(IDEA);
    const star = () => row.querySelector<HTMLButtonElement>('button[ui-star-toggle]') as HTMLButtonElement;
    const url = router.url;

    star().click();
    await settle();
    TestBed.tick();
    expect(writes).toEqual(['PUT harbor offline-sync']);
    expect(star().getAttribute('aria-pressed')).toBe('true');
    expect(router.url).toBe(url);
    expect(router.url).not.toContain('sel=');
    expect(row.querySelector('a.link')?.getAttribute('data-selected')).toBeNull();

    star().click();
    await settle();
    TestBed.tick();
    expect(writes).toEqual(['PUT harbor offline-sync', 'DELETE harbor offline-sync']);
    expect(star().getAttribute('aria-pressed')).toBe('false');
    expect(router.url).toBe(url);
  });
});
