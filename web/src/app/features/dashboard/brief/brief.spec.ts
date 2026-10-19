import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { formatDate } from '../../../shared/time';
import { Brief, type BriefModel } from './brief';

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

  it('names no command: the Spec plugin has none that writes specs/tldr.md (spec 031, ISC-265)', async () => {
    const { host } = await render(BRIEF);
    expect(host.querySelector('ui-command-chip')).toBeNull();
    expect(host.textContent).not.toMatch(/\/spec[ -]/);
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

});

// Spec 021 (T26, ISC-246): the workspace TL;DR (core's `sections`) stands on its first section, whole; one toggle in
// the footer opens the others, its state `?open=tldr`, so a reload keeps it; no command chip (spec 031).
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

  it('puts the toggle in the footer, after the first section, and no command chip anywhere', async () => {
    const { host, fold, toggle } = await render(SECTIONED);
    expect(host.querySelectorAll('ui-command-chip')).toHaveLength(0);
    expect(toggle()).not.toBeNull();
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

  it('a single section stands alone, with no toggle and no footer', async () => {
    const { host } = await render({ ...SECTIONED, sections: { overview: OVERVIEW } });
    expect(host.querySelector('ui-disclosure')).toBeNull();
    expect(host.querySelector('button[aria-expanded]')).toBeNull();
    expect(host.querySelector('[data-brief-foot]')).toBeNull();
  });

  it('reads the toggle in German', async () => {
    const { fixture, toggle } = await render(SECTIONED);
    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();
    expect(toggle()?.querySelector('[data-brief-toggle] > [aria-hidden="true"]')?.textContent.trim()).toBe('Ganzes TL;DR zeigen');
  });
});

// Spec 021 (T28, ISC-247): `lang:` in the frontmatter of specs/tldr.md names the brief's language. Only when its
// primary subtag differs from the interface language does the card carry a language chip in its head line and its
// text block (the first section and the folded rest) the `lang` attribute; without `lang` (null) neither appears.
describe('Brief language: chip and lang attribute on a mismatch (spec 021, T28)', () => {
  const SECTIONED: BriefModel = {
    markdown: '# TL;DR — harbor\n\n<!-- section: overview -->\n…',
    generated: GENERATED,
    stale: true,
    lang: null,
    sections: { overview: 'Der Abgleich ist fertig.', risks: '- Der Umbau des Laders betrifft jedes Paket.' },
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

  async function render(brief: BriefModel, ui: 'en' | 'de' = 'en') {
    TestBed.inject(TranslocoService).setActiveLang(ui);
    const fixture = TestBed.createComponent(Brief);
    fixture.componentRef.setInput('brief', brief);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const chip = () => host.querySelector<HTMLElement>('[data-brief-head] ui-chip[data-brief-lang]');
    const first = () => host.querySelector<HTMLElement>('[data-brief-first]');
    const rest = () => host.querySelector<HTMLElement>('[data-brief-rest]');
    return { fixture, host, chip, first, rest };
  }

  it('a German brief in the English UI carries the chip "DE" and lang="de" on both parts of its text block', async () => {
    const { host, chip, first, rest } = await render({ ...SECTIONED, lang: 'de' });
    expect(chip()?.querySelector('[aria-hidden="true"]')?.textContent.trim()).toBe('DE');
    expect(chip()?.querySelector('.visually-hidden')?.textContent.trim()).toBe('Language of the text: de');
    expect(first()?.getAttribute('lang')).toBe('de');
    expect(rest()?.getAttribute('lang')).toBe('de');
    // Head line order: as of …, then the language chip, then the stale chip.
    const asOf = host.querySelector('[data-brief-as-of]') as Node;
    const stale = host.querySelector('[data-brief-stale]') as Node;
    expect(chip()?.compareDocumentPosition(asOf)).toBe(Node.DOCUMENT_POSITION_PRECEDING);
    expect(chip()?.compareDocumentPosition(stale)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('a brief in the UI language carries neither chip nor lang attribute, compared by primary subtag', async () => {
    for (const [lang, ui] of [['en', 'en'], ['en-GB', 'en'], ['de', 'de'], ['de-CH', 'de']] as const) {
      const { host, chip, first, rest } = await render({ ...SECTIONED, lang }, ui);
      expect(chip()).toBeNull();
      expect(first()?.hasAttribute('lang')).toBe(false);
      expect(rest()?.hasAttribute('lang')).toBe(false);
      host.remove();
    }
  });

  it('an English brief in the German UI carries the chip "EN" named in German and lang="en"', async () => {
    const { chip, first, rest } = await render({ ...SECTIONED, lang: 'en' }, 'de');
    expect(chip()?.querySelector('[aria-hidden="true"]')?.textContent.trim()).toBe('EN');
    expect(chip()?.querySelector('.visually-hidden')?.textContent.trim()).toBe('Sprache des Textes: en');
    expect(first()?.getAttribute('lang')).toBe('en');
    expect(rest()?.getAttribute('lang')).toBe('en');
  });

  it('a brief without lang shows neither chip nor attribute, in English and German', async () => {
    for (const ui of ['en', 'de'] as const) {
      const { host, chip } = await render(SECTIONED, ui);
      expect(chip()).toBeNull();
      expect(host.querySelector('[data-brief-head] ui-chip:not([data-brief-stale])')).toBeNull();
      expect(host.querySelector('[lang]')).toBeNull();
      host.remove();
    }
  });

  it('the brief chip follows a switch of the UI language', async () => {
    const { fixture, chip, first } = await render({ ...SECTIONED, lang: 'de' });
    expect(chip()).not.toBeNull();
    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();
    expect(chip()).toBeNull();
    expect(first()?.hasAttribute('lang')).toBe(false);
  });

  it('a brief without sections carries lang on its clipped text block too', async () => {
    const { host, chip } = await render({ ...SECTIONED, sections: {}, lang: 'de' });
    expect(chip()).not.toBeNull();
    expect(host.querySelector('[data-brief-prose][data-clipped]')?.getAttribute('lang')).toBe('de');
  });
});

// Spec 021 (T33, ISC-248): every toggle of the TL;DR card names the TL;DR in its accessible name, which starts with the
// visible text (label in name, WCAG 2.5.3): the sectioned view's "Show whole TL;DR" and the clip view's "More…" /
// "Less" alike, so neither reads as a bare "More…" beside the Next up and spec head toggles.
describe('Brief toggles name the TL;DR (spec 021, T33)', () => {
  const SECTIONED: BriefModel = {
    markdown: '# TL;DR — harbor\n\n<!-- section: overview -->\n…',
    generated: GENERATED,
    stale: false,
    sections: { overview: 'Sync is done.', risks: '- The loader rewrite touches every package.' },
  };

  /** The accessible name as the accessibility tree computes it for a button: `aria-label`, else its non-hidden text. */
  function accessibleName(el: Element | null | undefined): string {
    if (!el) return '';
    const label = el.getAttribute('aria-label');
    if (label !== null) return label.trim();
    const text = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
      if (node instanceof Element && node.getAttribute('aria-hidden') === 'true') return '';
      return [...node.childNodes].map(text).join('');
    };
    return text(el).replace(/\s+/g, ' ').trim();
  }

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

  async function render(brief: BriefModel, lang: 'en' | 'de' = 'en') {
    TestBed.inject(TranslocoService).setActiveLang(lang);
    await TestBed.inject(Router).navigateByUrl('/');
    const fixture = TestBed.createComponent(Brief);
    fixture.componentRef.setInput('brief', brief);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const toggles = () => [...host.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')];
    return { fixture, host, toggles };
  }

  it('clip view: "More…" is named "More… of the TL;DR", "Less" "Less of the TL;DR"', async () => {
    const { fixture, toggles } = await render(BRIEF);
    expect(toggles()).toHaveLength(1);
    const [more] = toggles();
    expect(more.textContent.trim()).toBe('More…');
    expect(accessibleName(more)).toBe('More… of the TL;DR');
    more.click();
    await fixture.whenStable();
    expect(more.textContent.trim()).toBe('Less');
    expect(accessibleName(more)).toBe('Less of the TL;DR');
  });

  it('clip view in German: "Mehr… vom TL;DR", "Weniger vom TL;DR"', async () => {
    const { fixture, toggles } = await render(BRIEF, 'de');
    const [more] = toggles();
    expect(accessibleName(more)).toBe('Mehr… vom TL;DR');
    more.click();
    await fixture.whenStable();
    expect(accessibleName(more)).toBe('Weniger vom TL;DR');
  });

  it('sectioned view: the one toggle is named for the TL;DR, starting with its visible text, open or closed', async () => {
    const { fixture, toggles } = await render(SECTIONED);
    expect(toggles()).toHaveLength(1);
    const [toggle] = toggles();
    const visible = toggle.querySelector('[data-brief-toggle] > [aria-hidden="true"]')?.textContent.trim() ?? '';
    expect(visible).toBe('Show whole TL;DR');
    expect(accessibleName(toggle)).toBe('Show whole TL;DR, all sections of the brief');
    expect(accessibleName(toggle).startsWith(visible)).toBe(true);
    toggle.click();
    await fixture.whenStable();
    expect(toggles()[0]?.getAttribute('aria-expanded')).toBe('true');
    expect(accessibleName(toggles()[0])).toBe('Show whole TL;DR, all sections of the brief');
  });

  it('sectioned view in German names the TL;DR too', async () => {
    const { toggles } = await render(SECTIONED, 'de');
    expect(accessibleName(toggles()[0])).toBe('Ganzes TL;DR zeigen, alle Abschnitte der Kurzfassung');
  });
});
