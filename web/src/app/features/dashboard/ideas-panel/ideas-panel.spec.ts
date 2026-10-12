import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import harbor from '../../../../../../core/fixtures/harbor.golden.json';
import lantern from '../../../../../../core/fixtures/lantern.golden.json';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { type DashboardIdeas, IdeasPanel } from './ideas-panel';

// T138 · ISC-124.2: the dashboard lists the backlog's stories after the Specs panel in one collapsed disclosure
// "Ideas · n", each story as its idea chip with feature and milestone beside it; nothing renders without a story.

const HARBOR = (harbor as unknown as { ideas: DashboardIdeas }).ideas;
const LANTERN = (lantern as unknown as { ideas: DashboardIdeas }).ideas;

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

async function render(ideas: DashboardIdeas): Promise<{ root: HTMLElement; settle: () => Promise<void> }> {
  const fixture = TestBed.createComponent(IdeasPanel);
  fixture.componentRef.setInput('ws', 'harbor');
  fixture.componentRef.setInput('ideas', ideas);
  await fixture.whenStable();
  return { root: fixture.nativeElement as HTMLElement, settle: () => fixture.whenStable() };
}

describe('IdeasPanel (T138, ISC-124.2)', () => {
  it('renders one idea chip per story of the harbor golden, in model order, linking to the idea page', async () => {
    const { root } = await render(HARBOR);
    expect(HARBOR.count).toBe(2);
    const rows = [...root.querySelectorAll<HTMLElement>('[data-idea]')];
    expect(rows.map((row) => row.dataset['idea'])).toEqual(HARBOR.list.map((idea) => idea.slug));
    expect(root.querySelectorAll('ui-idea-chip')).toHaveLength(2);
    HARBOR.list.forEach((idea: DashboardIdeas['list'][number], i: number) => {
      const row = rows[i];
      const link = row.querySelector('ui-idea-chip a') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe(`/w/harbor/ideas/${idea.slug}`);
      expect(link.textContent.trim()).toBe(idea.title);
      expect(row.querySelector('[data-idea-where]')?.textContent.replace(/\s+/g, ' ').trim()).toBe(
        `${idea.feature ?? ''} · ${idea.milestone ?? ''}`,
      );
    });
  });

  it('heads the disclosure with the story count the model carries', async () => {
    const { root } = await render(HARBOR);
    expect(root.querySelector('ui-disclosure .summary [data-ideas-title]')).not.toBeNull();
    expect(root.getAttribute('data-ideas')).toBe('2');
  });

  it('is collapsed by default and expands on the summary', async () => {
    const { root, settle } = await render(HARBOR);
    const button = root.querySelector('ui-disclosure .summary') as HTMLButtonElement;
    const region = root.querySelector('ui-disclosure .region') as HTMLElement;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(region.hasAttribute('inert')).toBe(true);
    button.click();
    await settle();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(region.hasAttribute('inert')).toBe(false);
  });

  it('leaves out the muted text of a story with neither feature nor milestone, and shows the one it has', async () => {
    const { root } = await render({
      count: 2,
      list: [
        { slug: 'lone', title: 'Lone', feature: null, milestone: null, priority: 'P3' },
        { slug: 'half', title: 'Half', feature: 'F1', milestone: null, priority: 'P3' },
      ],
    });
    expect(root.querySelector('[data-idea="lone"] [data-idea-where]')).toBeNull();
    expect(root.querySelector('[data-idea="half"] [data-idea-where]')?.textContent.trim()).toBe('F1');
  });

  it('renders nothing on lantern, which has no story', async () => {
    expect(LANTERN.count).toBe(0);
    const { root } = await render(LANTERN);
    expect(root.hasAttribute('data-ideas')).toBe(false);
    expect(root.querySelector('ui-disclosure')).toBeNull();
    expect(root.querySelector('ui-idea-chip')).toBeNull();
  });
});
