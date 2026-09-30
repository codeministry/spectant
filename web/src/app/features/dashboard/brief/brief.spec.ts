import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
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

  it('heads the card with the TL;DR label, the as-of date in a <time> and the stale chip', async () => {
    const { host, head } = await render(BRIEF);
    const label = head()?.querySelector('[data-brief-label]');
    const asOf = head()?.querySelector<HTMLTimeElement>('time[data-brief-as-of]');
    const stale = head()?.querySelector('ui-chip[data-brief-stale]');
    const day = new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(GENERATED));

    expect(label?.textContent.trim()).toBe('TL;DR');
    expect(asOf?.getAttribute('datetime')).toBe(GENERATED);
    expect(asOf?.textContent.trim()).toBe(`as of ${day}`);
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

  it('carries the /spec-tldr command chip in the header, apart from the expander', async () => {
    const { host, head, more } = await render(BRIEF);
    const chip = host.querySelector('ui-command-chip[data-brief-command]');
    expect(TLDR_COMMAND).toBe('/spec-tldr');
    expect(chip?.querySelector('code')?.textContent.trim()).toBe('/spec-tldr');
    expect(head()?.contains(chip)).toBe(true);
    expect(more()?.contains(chip ?? null)).toBe(false);
    expect(chip?.querySelector('button')?.getAttribute('aria-label')).toBe('Copy command');
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
    const day = new Intl.DateTimeFormat('de', { dateStyle: 'medium' }).format(new Date(GENERATED));

    expect(host.querySelector('[data-brief-as-of]')?.textContent.trim()).toBe(`Stand ${day}`);
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
