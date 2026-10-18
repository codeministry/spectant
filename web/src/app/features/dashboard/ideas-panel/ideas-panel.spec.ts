import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import beacon from '../../../../../../core/fixtures/beacon.golden.json';
import harbor from '../../../../../../core/fixtures/harbor.golden.json';
import lantern from '../../../../../../core/fixtures/lantern.golden.json';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { ShellData } from '../../../layout/shell/shell-data.service';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { type DashboardIdeas, IdeasPanel } from './ideas-panel';

// T138 · ISC-124.2: the dashboard lists the backlog's stories after the Specs panel in one collapsed disclosure
// "Ideas · n", each story as its idea chip with feature and milestone beside it; nothing renders without a story.

const HARBOR = (harbor as unknown as { ideas: DashboardIdeas }).ideas;
const LANTERN = (lantern as unknown as { ideas: DashboardIdeas }).ideas;
const BEACON = (beacon as unknown as { ideas: DashboardIdeas }).ideas;

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [provideRouter([]), { provide: ShellData, useValue: { planningModel: () => null } }, { provide: ShellState, useValue: { tier: () => 'wide' } }],
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

  // Spec 040 (T50, ISC-224): each story's state line from its served state.
  it('shows each story\'s state line: harbor\'s open with `/spec new <slug>`, beacon\'s running story with its run', async () => {
    const { root } = await render(HARBOR);
    for (const idea of HARBOR.list) {
      const state = root.querySelector<HTMLElement>(`[data-idea="${idea.slug}"] ui-item-state`);
      expect(state?.dataset['state']).toBe('open');
      expect(state?.querySelector('[data-item-line]')?.textContent.replace(/\s+/g, ' ').trim()).toBe('Idea · open');
      expect(state?.querySelector('ui-command-chip')?.textContent).toContain(`/spec new ${idea.slug}`);
    }
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' }, preloadLangs: true })],
      providers: [provideRouter([]), { provide: ShellData, useValue: { planningModel: () => null } }, { provide: ShellState, useValue: { tier: () => 'wide' } }],
    });
    const run = await render(BEACON);
    const running = run.root.querySelector<HTMLElement>('[data-idea="uptime-badges"] ui-item-state');
    expect(running?.dataset['state']).toBe('running');
    expect(running?.querySelector('ui-command-chip')?.textContent).toContain('/spec new uptime-badges');
    expect(running?.querySelector('ui-actor-chip')?.textContent).toContain('a:claude:sess-71');
  });

  it('shows no state line for a story the server served without a state', async () => {
    const { root } = await render({ count: 1, list: [{ slug: 'lone', title: 'Lone', feature: null, milestone: null, priority: 'P3' }] });
    expect(root.querySelector('[data-idea="lone"] ui-item-state')).toBeNull();
  });

  it('renders nothing on lantern, which has no story', async () => {
    expect(LANTERN.count).toBe(0);
    const { root } = await render(LANTERN);
    expect(root.hasAttribute('data-ideas')).toBe(false);
    expect(root.querySelector('ui-disclosure')).toBeNull();
    expect(root.querySelector('ui-idea-chip')).toBeNull();
  });
});

describe('IdeasPanel selection (spec 026, T28, ISC-171)', () => {
  it('a plain click on a chip selects idea:<slug> and marks its row; the chip names the object', async () => {
    const { root, settle } = await render(HARBOR);
    const idea = HARBOR.list[0];
    const link = root.querySelector<HTMLAnchorElement>(`li[data-idea="${idea.slug}"] a`);
    expect(link?.getAttribute('data-ref')).toBe(`idea:${idea.slug}`);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link?.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(TestBed.inject(Router).url).toBe(`/?sel=idea:${idea.slug}`);
    expect(root.querySelector(`li[data-idea="${idea.slug}"]`)?.getAttribute('data-selected')).toBe('row');
  });
});
