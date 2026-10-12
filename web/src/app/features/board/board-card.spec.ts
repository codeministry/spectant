import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import dashboard from '../../../../../core/fixtures/harbor.golden.json';
import planningGolden from '../../../../../core/fixtures/harbor.planning.golden.json';
import type { PlanningModel } from '../../../../../core/src/planning';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { BoardCard } from './board-card';
import { type BoardCard as BoardCardModel, type BoardRow, buildBoard } from './board-model';

// T122 · ISC-129 / ISC-131 / ISC-122.3: one board card's anatomy, rendered from the harbor board as `buildBoard` builds
// it: the type glyph and number (or the idea chip's look), the priority, the feature, milestone and assignee chips,
// the reason line on waiting cards only, the decorative grip, the `ui-card` variants and the one link.

const BOARD = buildBoard({
  planning: planningGolden as unknown as PlanningModel,
  rows: dashboard.specs as unknown as readonly BoardRow[],
  actors: [{ id: 'u:3f9c0a7d', displayName: 'Harbor maintainer' }],
});
const cardOf = (key: string): BoardCardModel => {
  const found = BOARD.cards.find((c) => c.id === key || c.slug === key);
  if (!found) throw new Error(`no card ${key}`);
  return found;
};

async function render(key: string): Promise<HTMLElement> {
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
  const fixture = TestBed.createComponent(BoardCard);
  fixture.componentRef.setInput('card', cardOf(key));
  fixture.componentRef.setInput('ws', 'harbor');
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('BoardCard (T122, ISC-129)', () => {
  it('renders 008 close-pending: number, title link, F6, the reason line without a command chip', async () => {
    const host = await render('008');
    const c = cardOf('008');
    expect(host.dataset['stage']).toBe('close-pending');
    expect(host.querySelector('ui-type-glyph')?.getAttribute('data-type')).toBe('spike');
    expect(text(host.querySelector('.num'))).toBe('008');
    const link = host.querySelector<HTMLAnchorElement>('a.title');
    expect(link?.getAttribute('href')).toBe('/w/harbor/s/008');
    expect(text(link)).toBe(c.title);
    expect(link?.getAttribute('aria-label')).toBe(`Spec 008, spike, ${c.title}, priority ${c.priority}, stage Close-pending`);
    const described = host.querySelector(`[id="${link?.getAttribute('aria-describedby') ?? '-'}"]`);
    expect(text(described)).toBe('waits: every claim is closed and F6 waits on spec 009');
    expect(text(host.querySelector('.feat'))).toBe('F6');
    expect(host.querySelector('.feat')?.getAttribute('title')).toBe('Feature F6: Registry compatibility');
    const reason = host.querySelector('ui-reason');
    expect(reason).not.toBeNull();
    expect(reason?.hasAttribute('data-compact')).toBe(true);
    expect(text(reason?.querySelector('.visually-hidden'))).toBe('every claim is closed and F6 waits on spec 009');
    expect(reason?.querySelector('ui-command-chip')).toBeNull();
    expect(host.querySelector('ui-actor-chip')?.textContent).toContain('Harbor maintainer');
  });

  it('renders 006 with its P1 priority and the violet edge of a wait on you, with the command chip', async () => {
    const host = await render('006');
    expect(host.querySelector('ui-priority')?.getAttribute('data-level')).toBe('P1');
    const card = host.querySelector<HTMLElement>('ui-card');
    expect(card?.hasAttribute('data-side')).toBe(true);
    expect(card?.hasAttribute('data-dashed')).toBe(false);
    expect(card?.style.getPropertyValue('--edge')).toBe('var(--color-secondary)');
    expect(host.querySelector('ui-reason ui-command-chip')).not.toBeNull();
    expect(host.querySelector('ui-reason ui-command-chip')?.textContent).toContain(cardOf('006').command ?? '-');
  });

  it('renders a story with the dashed card, the idea look (lightbulb, slug) and a link to its idea page', async () => {
    const host = await render('registry-webhooks');
    const c = cardOf('registry-webhooks');
    const card = host.querySelector<HTMLElement>('ui-card');
    expect(card?.hasAttribute('data-dashed')).toBe(true);
    expect(card?.style.getPropertyValue('--edge')).toBe('var(--track)');
    expect(host.querySelector('.num')).toBeNull();
    expect(text(host.querySelector('.idea .slug'))).toBe('registry-webhooks');
    expect(host.querySelector('.idea ui-icon')).not.toBeNull();
    const link = host.querySelector<HTMLAnchorElement>('a.title');
    expect(link?.getAttribute('href')).toBe('/w/harbor/ideas/registry-webhooks');
    expect(link?.getAttribute('aria-label')).toBe(`Idea, ${c.title}, priority P2`);
    expect(link?.hasAttribute('aria-describedby')).toBe(false);
    expect(host.querySelector('ui-reason')).toBeNull();
    expect(text(host.querySelector('.ms'))).toBe('Harbor 1.0');
  });

  it('shows no assignee chip on a card nobody holds, and the raw id for an unmapped person', async () => {
    expect(cardOf('004').assignee).toBeNull();
    const host = await render('004');
    expect(host.querySelector('ui-actor-chip')).toBeNull();
    TestBed.resetTestingModule();
    const unmapped = buildBoard({
      planning: planningGolden as unknown as PlanningModel,
      rows: dashboard.specs as unknown as readonly BoardRow[],
    }).cards.find((c) => c.id === '002');
    expect(unmapped?.assigneeName).toBeNull();
  });

  it('has exactly one link and, at the trailing edge, the grip as the "Move to…" button (T127)', async () => {
    const host = await render('002');
    expect(host.querySelectorAll('a')).toHaveLength(1);
    const grip = host.querySelector<HTMLButtonElement>('[data-grip]');
    expect(grip?.tagName).toBe('BUTTON');
    expect(grip?.getAttribute('type')).toBe('button');
    expect(grip?.getAttribute('aria-label')).toBe('Move 002');
    expect(grip?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(grip?.querySelector('ui-icon')).not.toBeNull();
    expect(host.querySelector('ui-reason')).toBeNull();
  });

  it('a story\'s grip is named by its slug', async () => {
    const host = await render('registry-webhooks');
    expect(host.querySelector('[data-grip]')?.getAttribute('aria-label')).toBe('Move registry-webhooks');
  });
});
