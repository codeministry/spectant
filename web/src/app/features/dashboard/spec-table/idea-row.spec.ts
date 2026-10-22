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
import { SpecRow } from './spec-row';
import { readSpecRows } from './spec-table-model';

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
    expect(row.querySelector('[data-row-feature]')?.textContent.trim()).toBe('F3');
    expect(row.querySelector('[data-row-milestone]')?.textContent.trim()).toBe('M2');
    expect(row.querySelector('ui-priority')?.getAttribute('data-level')).toBe('P2');
    expect(row.querySelector('[data-idea-state]')?.getAttribute('data-state')).toBe('open');
  });

  // Spec 064 (T47, ISC-488): the idea row fills the spec row's named columns, each cell rendered even when empty.
  it('puts each part in the spec row\'s column: glyph in id, title in title, feature and milestone in feature, priority in prio, state in phase (T47)', async () => {
    const row = await render(IDEA);
    const cell = (name: string) => row.querySelector<HTMLElement>(`:scope > [data-cell="${name}"]`);
    expect([...row.children].map((child) => child.getAttribute('data-cell'))).toEqual(['id', 'title', 'feature', 'mark', 'agent', 'prio', 'track', 'phase', 'meter', 'star']);
    expect(cell('id')?.querySelector('ui-icon')).not.toBeNull();
    expect(cell('title')?.querySelector('[data-idea-title]')).not.toBeNull();
    expect(cell('feature')?.querySelector('[data-row-feature]')?.textContent.trim()).toBe('F3');
    expect(cell('feature')?.querySelector('[data-row-milestone]')?.textContent.trim()).toBe('M2');
    expect(cell('prio')?.querySelector('ui-priority')).not.toBeNull();
    expect(cell('phase')?.querySelector('[data-idea-state]')).not.toBeNull();
    expect(cell('phase')?.querySelector('ui-command-chip')).toBeNull();
    for (const empty of ['mark', 'agent', 'track', 'meter']) expect(cell(empty)?.children.length).toBe(0);
    expect(cell('star')?.querySelector('button[ui-star-toggle]')).not.toBeNull();
    expect(row.querySelector('.rtrack ui-priority, .rtrack [data-idea-state]')).toBeNull();
  });

  it('leaves out feature, milestone and state the story does not name', async () => {
    const row = await render({ ...IDEA, feature: null, milestone: 'M2', state: undefined });
    expect(row.querySelector('[data-row-feature]')).toBeNull();
    expect(row.querySelector('[data-row-milestone]')?.textContent.trim()).toBe('M2');
    expect(row.querySelector('[data-idea-state]')).toBeNull();
    const bare = await render({ ...IDEA, feature: null, milestone: null, state: undefined });
    expect(bare.querySelector('[data-row-feature], [data-row-milestone]')).toBeNull();
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
      expect(row.querySelector('[data-idea-state]')).not.toBeNull();
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

describe('IdeaRow status pill (spec 064, T69, ISC-510)', () => {
  type State = NonNullable<DashboardIdea['state']>['state'];
  const inState = (state: State): DashboardIdea => ({ ...IDEA, state: { kind: 'idea', id: IDEA.slug, state, stage: 'idea' } });
  const pill = (row: HTMLElement) => row.querySelector<HTMLElement>(':scope > [data-cell="phase"] > ui-chip');
  const words = (el: Element | null) => el?.textContent.replace(/\s+/g, ' ').trim();

  /** The spec row's stage chip, the form the idea's state pill takes. */
  function stageChip(): HTMLElement {
    const fixture = TestBed.createComponent(SpecRow);
    fixture.componentRef.setInput('row', readSpecRows({ specs: [{ id: '005', title: 'Board', stage: 'plan' }] })[0]);
    fixture.componentRef.setInput('stageLabels', ['Plan']);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector(':scope > [data-cell="phase"] > ui-chip') as HTMLElement;
  }

  it("shows each state as the spec row's stage chip: the same ui-chip, variant and dot, one tone per state, text as before", async () => {
    const stage = stageChip();
    expect(stage.querySelector(':scope > .dot')).not.toBeNull();
    // The tones of the item glyph family (ITEM_GLYPHS, spec 040): one per state, so no two states share a pill.
    const cases: Array<[State, string, string]> = [
      ['open', 'secondary', 'Idea · open'],
      ['running', 'primary', 'Idea · running'],
      ['waiting', 'neutral', 'Idea · waiting'],
      ['aborted', 'warning', 'Idea · aborted'],
      ['done', 'accent', 'Idea · done'],
    ];
    for (const [state, tone, text] of cases) {
      const row = await render(inState(state));
      const chip = pill(row);
      expect(chip?.tagName).toBe(stage.tagName);
      expect(chip?.getAttribute('data-variant')).toBe(stage.getAttribute('data-variant'));
      expect(chip?.classList.contains('phase')).toBe(true);
      expect(chip?.querySelector(':scope > .dot')).not.toBeNull();
      expect(chip?.getAttribute('data-tone')).toBe(tone);
      expect(words(chip)).toBe(text);
      expect(row.querySelector('ui-item-state, ui-command-chip, ui-actor-chip')).toBeNull();
    }
    expect(new Set(cases.map(([, tone]) => tone)).size).toBe(cases.length);
  });

  it('keeps the text in German', async () => {
    expect(words(pill(await render(inState('open'), 'de')))).toBe('Idee · offen');
    expect(words(pill(await render(inState('running'), 'de')))).toBe('Idee · läuft');
  });
});
