import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import type { DashboardIdea } from '../ideas-panel/ideas-panel';
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

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [provideRouter([])],
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
