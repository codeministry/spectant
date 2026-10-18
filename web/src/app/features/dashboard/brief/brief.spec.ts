import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { formatDate } from '../../../shared/time';
import { Brief, type BriefModel, TLDR_COMMAND } from './brief';

// The model's `brief` as core builds it (sections included); noon UTC: the same calendar day in every time zone a
// developer or the CI container runs in.
const GENERATED = '2026-03-07T12:00:00Z';

const BRIEF: BriefModel & { readonly sections: Readonly<Record<string, string>> } = {
  markdown: [
    '# TL;DR — harbor',
    '',
    '<!-- section: overview -->',
    'Sync is **done** and archived (001).',
    '',
    '<!-- section: risks -->',
    '- The loader rewrite <img src=x onerror="alert(1)"> touches every package.',
  ].join('\n'),
  generated: GENERATED,
  stale: true,
  sections: {},
};

describe('Brief', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en', reRenderOnLangChange: true },
          preloadLangs: true,
        }),
      ],
      providers: [provideRouter([])],
    });
  });

  async function render(brief: BriefModel | null, open?: boolean) {
    const fixture = TestBed.createComponent(Brief);
    fixture.componentRef.setInput('brief', brief);
    if (open !== undefined) fixture.componentRef.setInput('open', open);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const head = () => host.querySelector<HTMLElement>('[data-brief-head]');
    const body = () => host.querySelector<HTMLElement>('[data-brief-prose]');
    const more = () => host.querySelector<HTMLButtonElement>('button[data-brief-more]');
    return { fixture, host, head, body, more };
  }

  it('renders nothing while the workspace has no TL;DR', async () => {
    const { host } = await render(null);
    expect(host.querySelector('ui-card')).toBeNull();
    expect(host.hasAttribute('hidden')).toBe(true);
  });

  it('is a card with the header, a clipped body and a "More" expander, not a disclosure', async () => {
    const { host, head, body, more } = await render(BRIEF);
    expect(host.hasAttribute('hidden')).toBe(false);
    expect(host.querySelector('ui-disclosure')).toBeNull();
    const card = host.querySelector('ui-card[data-ui="brief"]');
    expect(card).not.toBeNull();
    expect(card?.hasAttribute('data-edge')).toBe(false);
    expect(card?.hasAttribute('data-glow')).toBe(false);
    expect(card?.contains(head())).toBe(true);

    expect(body()?.hasAttribute('data-clipped')).toBe(true);
    expect(more()?.getAttribute('type')).toBe('button');
    expect(more()?.getAttribute('aria-expanded')).toBe('false');
    expect(more()?.getAttribute('aria-controls')).toBe(body()?.id);
    expect(more()?.textContent.trim()).toBe('More…');
  });

  it('heads the card with the TL;DR label, the as-of date in a <time> through the shared formatter and the stale chip', async () => {
    const { host, head } = await render(BRIEF);
    const label = head()?.querySelector('[data-brief-label]');
    const asOf = head()?.querySelector('ui-time-label[data-brief-as-of]');
    const time = asOf?.querySelector<HTMLTimeElement>('ui-time time');
    const stale = head()?.querySelector('ui-chip[data-brief-stale]');

    expect(label?.textContent.trim()).toBe('TL;DR');
    // `generated:` is an instant, so the Brief shows its local date (form `date`), not a UTC calendar day.
    expect(time?.getAttribute('datetime')).toBe(GENERATED);
    expect(time?.textContent).toBe(formatDate(GENERATED, 'en'));
    expect(asOf?.textContent.trim()).toBe(`as of ${formatDate(GENERATED, 'en')}`);
    expect(stale?.textContent.trim()).toBe('stale');
    expect(stale?.getAttribute('data-tone')).toBe('warning');
    expect(host.getAttribute('data-stale')).toBe('');
  });

  it('shows no stale chip on a fresh TL;DR and no date when `generated` is absent or no time', async () => {
    const fresh = await render({ ...BRIEF, stale: false });
    expect(fresh.host.querySelector('[data-brief-stale]')).toBeNull();
    expect(fresh.host.hasAttribute('data-stale')).toBe(false);

    const undated = await render({ ...BRIEF, generated: null });
    expect(undated.host.querySelector('[data-brief-as-of]')).toBeNull();
    const invalid = await render({ ...BRIEF, generated: 'last tuesday' });
    expect(invalid.host.querySelector('[data-brief-as-of]')).toBeNull();
  });

  it('names the spec worktree a TL;DR was read from beside its label, and nothing for the main checkout (spec 039)', async () => {
    const fromCopy = await render({ ...BRIEF, source: { kind: 'worktree', worktree: '.worktrees/012-harbor' } });
    const chip = fromCopy.head()?.querySelector<HTMLElement>('[data-brief-source]');
    expect(chip?.hasAttribute('hidden')).toBe(false);
    expect(chip?.textContent.replace(/\s+/g, ' ').trim()).toBe('from worktree 012-harbor');
    const fromMain = await render(BRIEF);
    expect(fromMain.head()?.querySelector('[data-brief-source]')?.hasAttribute('hidden')).toBe(true);
  });

  it('carries the /spec-tldr command chip in the header, apart from the expander', async () => {
    const { host, head, more } = await render(BRIEF);
    const chip = host.querySelector('ui-command-chip[data-brief-command]');
    expect(TLDR_COMMAND).toBe('/spec-tldr');
    expect(chip?.querySelector('code')?.textContent.trim()).toBe('/spec-tldr');
    expect(head()?.contains(chip)).toBe(true);
    expect(more()?.contains(chip ?? null)).toBe(false);
    expect(chip?.querySelector('button')?.getAttribute('aria-label')).toBe('Copy /spec-tldr');
  });

  it('expands on "More" and clips again on "Less"', async () => {
    const { fixture, body, more } = await render(BRIEF);
    more()?.click();
    await fixture.whenStable();
    expect(more()?.getAttribute('aria-expanded')).toBe('true');
    expect(more()?.textContent.trim()).toBe('Less');
    expect(body()?.hasAttribute('data-clipped')).toBe(false);

    more()?.click();
    await fixture.whenStable();
    expect(more()?.getAttribute('aria-expanded')).toBe('false');
    expect(body()?.hasAttribute('data-clipped')).toBe(true);
  });

  it('renders the full markdown through core’s renderer, clipped or not: formatting kept, raw HTML and comments not', async () => {
    const { host } = await render(BRIEF);
    const prose = host.querySelector<HTMLElement>('[data-brief-prose]');

    expect(prose?.querySelector('h1')?.textContent).toContain('TL;DR — harbor');
    expect(prose?.querySelector('h1')?.id).toMatch(/^brief-/);
    expect(prose?.querySelector('strong')?.textContent).toBe('done');
    expect(prose?.querySelector('img')).toBeNull();
    expect(prose?.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(prose?.innerHTML).not.toContain('section:');
  });

  it('binds `open` (expanded) both ways, so the page can drive it from a query param', async () => {
    const { fixture, body, more } = await render(BRIEF, true);
    expect(more()?.getAttribute('aria-expanded')).toBe('true');
    expect(body()?.hasAttribute('data-clipped')).toBe(false);

    const seen: boolean[] = [];
    fixture.componentInstance.open.subscribe((value) => seen.push(value));
    more()?.click();
    await fixture.whenStable();
    expect(seen).toEqual([false]);
  });

  it('follows the active language', async () => {
    const { fixture, host } = await render(BRIEF);
    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();
    expect(host.querySelector('[data-brief-as-of]')?.textContent.trim()).toBe(`Stand ${formatDate(GENERATED, 'de')}`);
    expect(host.querySelector('[data-brief-stale]')?.textContent.trim()).toBe('veraltet');
    expect(host.querySelector('[data-brief-more]')?.textContent.trim()).toBe('Mehr…');
  });

  it('passes a copy on as `copied`, for the page’s live region', async () => {
    const { fixture, host } = await render(BRIEF);
    const copied: string[] = [];
    fixture.componentInstance.copied.subscribe((command) => copied.push(command));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.resolve() } });

    host.querySelector<HTMLButtonElement>('ui-command-chip button')?.click();
    await fixture.whenStable();
    expect(copied).toEqual(['/spec-tldr']);
  });
});

// Spec 021 (T26, ISC-246): the workspace TL;DR (core's `sections`) stands on its first section, whole; one toggle in
// the footer opens the others, its state `?open=tldr`, so a reload keeps it; `/spec-tldr` sits at the footer's end.
describe('Brief folded to its first section (spec 021, T26)', () => {
  const OVERVIEW = 'Sync is **done** and archived (001). '.repeat(12).trim();
  const SECTIONED: BriefModel = {
    markdown: '# TL;DR — harbor\n\n<!-- section: overview -->\n…',
    generated: GENERATED,
    stale: false,
    sections: { overview: OVERVIEW, try: 'Run `harbor sync --dry-run`.', risks: '- The loader rewrite touches every package.' },
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en', reRenderOnLangChange: true },
          preloadLangs: true,
        }),
      ],
      providers: [provideRouter([])],
    });
  });

  async function render(brief: BriefModel, url = '/') {
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    const fixture = TestBed.createComponent(Brief);
    fixture.componentRef.setInput('brief', brief);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const first = () => host.querySelector<HTMLElement>('[data-brief-first]');
    const fold = () => host.querySelector<HTMLElement>('ui-disclosure[data-brief-fold]');
    const toggle = () => fold()?.querySelector<HTMLButtonElement>('button[aria-expanded]') ?? null;
    const rest = () => fold()?.querySelector<HTMLElement>('[data-brief-rest]') ?? null;
    return { fixture, host, router, first, fold, toggle, rest };
  }

  it('shows the first section whole, unclipped, and nothing of the file before the first marker', async () => {
    const { host, first } = await render(SECTIONED);
    expect(first()?.hasAttribute('data-clipped')).toBe(false);
    expect(first()?.textContent.replace(/\s+/g, ' ').trim()).toBe(OVERVIEW.replaceAll('**', ''));
    expect(first()?.querySelector('strong')?.textContent).toBe('done');
    expect(host.textContent).not.toContain('TL;DR — harbor');
    expect(host.querySelector('[data-brief-more]')).toBeNull();
  });

  it('folds the other sections behind one toggle, closed, named for the TL;DR', async () => {
    const { host, fold, toggle, rest } = await render(SECTIONED);
    expect(host.querySelectorAll('ui-disclosure')).toHaveLength(1);
    expect(host.querySelectorAll('button[aria-expanded]')).toHaveLength(1);
    expect(fold()?.hasAttribute('data-open')).toBe(false);
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
    expect(rest()?.closest('[inert]')).not.toBeNull();
    expect(rest()?.textContent).toContain('harbor sync --dry-run');
    expect(rest()?.querySelector('li')?.textContent).toContain('The loader rewrite');
    // Visible text "Show whole TL;DR"; the accessible name starts with it and names the brief (label in name).
    expect(toggle()?.querySelector('[data-brief-toggle] > [aria-hidden="true"]')?.textContent.trim()).toBe('Show whole TL;DR');
    expect(toggle()?.querySelector('.visually-hidden')?.textContent.trim()).toBe('Show whole TL;DR, all sections of the brief');
  });

  it('puts the toggle and the /spec-tldr chip in the footer, the chip at the end and outside the toggle', async () => {
    const { host, fold, toggle } = await render(SECTIONED);
    const chip = host.querySelector<HTMLElement>('ui-command-chip[data-brief-command]');
    expect(host.querySelectorAll('ui-command-chip')).toHaveLength(1);
    expect(host.querySelector('[data-brief-head]')?.contains(chip)).toBe(false);
    expect(toggle()?.contains(chip)).toBe(false);
    const head = toggle()?.parentElement;
    expect(head?.contains(chip)).toBe(true);
    expect(head?.lastElementChild?.contains(chip)).toBe(true);
    expect(fold()?.compareDocumentPosition(host.querySelector('[data-brief-first]') as Node)).toBe(Node.DOCUMENT_POSITION_PRECEDING);
  });

  it('opens on the toggle, writes `?open=tldr` and keeps focus on it; closing drops it again', async () => {
    const { fixture, router, fold, toggle, rest } = await render(SECTIONED, '/?sel=spec:002');
    toggle()?.focus();
    toggle()?.click();
    await fixture.whenStable();
    expect(router.url).toBe('/?sel=spec:002&open=tldr');
    expect(fold()?.hasAttribute('data-open')).toBe(true);
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
    expect(rest()?.closest('[inert]')).toBeNull();
    expect(document.activeElement).toBe(toggle());

    toggle()?.click();
    await fixture.whenStable();
    expect(router.url).toBe('/?sel=spec:002');
    expect(fold()?.hasAttribute('data-open')).toBe(false);
  });

  it('a reload with `?open=tldr` shows the whole TL;DR', async () => {
    const { fold, toggle } = await render(SECTIONED, '/?open=tldr');
    expect(fold()?.hasAttribute('data-open')).toBe(true);
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
  });

  it('a single section stands alone with the chip in the footer and no toggle', async () => {
    const { host } = await render({ ...SECTIONED, sections: { overview: OVERVIEW } });
    expect(host.querySelector('ui-disclosure')).toBeNull();
    expect(host.querySelector('button[aria-expanded]')).toBeNull();
    expect(host.querySelector('[data-brief-foot] ui-command-chip')).not.toBeNull();
  });

  it('reads the toggle in German', async () => {
    const { fixture, toggle } = await render(SECTIONED);
    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();
    expect(toggle()?.querySelector('[data-brief-toggle] > [aria-hidden="true"]')?.textContent.trim()).toBe('Ganzes TL;DR zeigen');
  });
});
