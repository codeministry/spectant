import { ApplicationRef, signal } from '@angular/core';
import { DeferBlockBehavior, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import de from '../../../i18n/de.json';
import en from '../../../i18n/en.json';
import { LockSourceService } from '../../core/lock-source.service';
import type { SheetTier } from '../../shared/ui/overlay/sheet';
import { RefreshService } from './refresh.service';
import { ShellData } from './shell-data.service';
import { ShellLive } from './shell-live';
import { ShellState } from './shell-state.service';

/** Every text node of `root`, each its own word run, so adjacent blocks never run together ("LiveReading"). */
function words(root: Element | null): string {
  if (root === null) return '';
  const parts: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) parts.push(node.textContent ?? '');
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

type Lang = 'en' | 'de';
type Source = 'none' | 'activity';
const CATALOGUES = { en, de } as const;

/** Where the popover opens: the open workspace (null outside one), the open spec's board link (null without one), the tier. */
interface Place {
  readonly ws: string | null;
  readonly link: readonly string[] | null;
  readonly tier: SheetTier;
}
const SPEC_PAGE: Place = { ws: 'harbor', link: ['/w', 'harbor', 's', '002', 'board'], tier: 'medium' };

/**
 * Opens the header's status popover alone in `lang` under lock source `source` at `place` (harbor's spec page by
 * default): a route-only `ShellState`, a `ShellData` with two workspaces and no services, a stub `RefreshService`; the
 * popover's `showPopover` and the sheet's `showModal` are stubbed by the caller, as the DOM has neither.
 */
async function openPopover(lang: Lang, source: Source, place: Place = SPEC_PAGE): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: { [lang]: CATALOGUES[lang] },
        translocoConfig: { availableLangs: [lang], defaultLang: lang },
        preloadLangs: true,
      }),
    ],
    providers: [
      provideRouter([]),
      { provide: ShellState, useValue: { ws: signal(place.ws), tier: signal(place.tier) } },
      {
        provide: ShellData,
        useValue: { workspaceList: signal([{ slug: 'harbor' }, { slug: 'quay' }]), dashboard: { value: signal(undefined) } },
      },
      { provide: RefreshService, useValue: { lastRefresh: signal(0), refresh: () => undefined } },
    ],
    deferBlockBehavior: DeferBlockBehavior.Playthrough,
  });
  TestBed.inject(LockSourceService).connect(signal({ lockSource: source, lock: null, agentsWorking: 0 }));
  const fixture = TestBed.createComponent(ShellLive);
  fixture.componentRef.setInput('link', place.link);
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  root.querySelector<HTMLButtonElement>('[data-control="live"]')?.click();
  await fixture.whenStable();
  return root;
}

/** Spec 071 T19 (ISC-579): the cleaned status popover names neither a "Live" heading, nor "Updated … ago", nor the agent source. */
describe('ShellLive popover (spec 071, ISC-579)', () => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  beforeEach(() => {
    proto['showPopover'] = vi.fn();
    proto['hidePopover'] = vi.fn();
  });
  afterEach(() => {
    delete proto['showPopover'];
    delete proto['hidePopover'];
  });

  const CASES = (['en', 'de'] as const).flatMap((lang) => (['none', 'activity'] as const).map((source) => [lang, source] as const));

  it.each(CASES)('in %s under source %s shows no Live heading, no updated line and no agent source', async (lang, source) => {
    const root = await openPopover(lang, source);
    const live = CATALOGUES[lang].shell.live;
    const trigger = root.querySelector('[data-control="live"]');
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    const panel = root.querySelector('ui-popover.live-pop .panel');
    expect(panel).not.toBeNull();
    const text = words(panel);
    // What stays: the reading line, the board link and the dev services section.
    expect(panel?.querySelector('[data-live-reading]')).not.toBeNull();
    expect(panel?.querySelector('[data-live-board]')).not.toBeNull();
    expect(text).toContain(live.services);

    expect(text).not.toMatch(/\bLive\b/i);
    expect([...(panel?.querySelectorAll('.pop-head') ?? [])].map((head) => head.textContent.trim())).toEqual([live.services]);
    expect(panel?.querySelector('[data-live-updated]')).toBeNull();
    expect(panel?.querySelector('[data-live-source]')).toBeNull();
    expect(text).not.toMatch(/Updated|Aktualisiert/i);
    for (const name of ['none', 'activity', 'frontier'] as const) expect(text).not.toContain(live.source[name]);
    expect(text).not.toMatch(/agent source|Agentenquelle/i);
  });
});

/** Spec 071 T20 (ISC-595): the status popover carries no visible heading; its accessible name is "Status" in en and de. */
describe('ShellLive popover name (spec 071, ISC-595)', () => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  beforeEach(() => {
    proto['showPopover'] = vi.fn();
    proto['hidePopover'] = vi.fn();
  });
  afterEach(() => {
    delete proto['showPopover'];
    delete proto['hidePopover'];
  });

  it.each(['en', 'de'] as const)('in %s is named "Status" and opens on the reading line', async (lang) => {
    const root = await openPopover(lang, 'activity');
    const panel = root.querySelector('ui-popover.live-pop .panel');
    expect(panel?.getAttribute('role')).toBe('dialog');
    expect(panel?.getAttribute('aria-label')).toBe('Status');
    // Nothing precedes the reading line: it is the panel's first element, and no heading sits anywhere in the panel.
    expect(panel?.firstElementChild?.hasAttribute('data-live-reading')).toBe(true);
    expect(panel?.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]')).toBeNull();
  });
});

/** Each element child of the popover's (or the sheet's) content, named by what it is, in DOM order. */
function rows(panel: Element | null): string[] {
  return [...(panel?.children ?? [])].map((row) => {
    if (row.hasAttribute('data-live-reading')) return 'reading';
    if (row.hasAttribute('data-live-widget')) return 'widget';
    if (row.hasAttribute('data-live-board')) return 'board';
    if (row.classList.contains('pop-sep')) return 'sep';
    if (row.classList.contains('pop-head')) return `head:${row.textContent.trim()}`;
    if (row.hasAttribute('data-live-services-empty')) return 'no-services';
    if (row.hasAttribute('data-live-service')) return 'service';
    return row.tagName.toLowerCase();
  });
}

/**
 * Spec 071 T21/T22 (ISC-580): the open status popover lists, top to bottom, the reading line with its dot, the "Open
 * status widget" button (the one autofocus target), the round-board link only while a spec is open, then Dev services;
 * below 640 px (compact) the same rows in the same order sit in a bottom `ui-sheet` named "Status", without a heading.
 */
describe('ShellLive popover order (spec 071, ISC-580)', () => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const dialogProto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  beforeEach(() => {
    proto['showPopover'] = vi.fn();
    proto['hidePopover'] = vi.fn();
    dialogProto['showModal'] = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    dialogProto['close'] = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });
  afterEach(() => {
    delete proto['showPopover'];
    delete proto['hidePopover'];
    delete dialogProto['showModal'];
    delete dialogProto['close'];
  });

  const ROUTES = [
    ['/', null, null],
    ['/w/harbor', 'harbor', null],
    ['/w/harbor/s/002', 'harbor', SPEC_PAGE.link],
  ] as const;
  const CASES = (['medium', 'wide', 'compact'] as const).flatMap((tier) =>
    (['en', 'de'] as const).flatMap((lang) => ROUTES.map(([route, ws, link]) => [tier, lang, route, { ws, link, tier }] as const)),
  );

  it.each(CASES)('at %s in %s on %s: reading, widget button, board link only on a spec, dev services', async (tier, lang, route, place) => {
    const root = await openPopover(lang, 'activity', place);
    const live = CATALOGUES[lang].shell.live;
    const panel = tier === 'compact' ? root.querySelector('ui-sheet dialog .body') : root.querySelector('ui-popover.live-pop .panel');
    expect(panel).not.toBeNull();
    expect(root.querySelector('[data-control="live"]')?.getAttribute('aria-expanded')).toBe('true');
    if (tier === 'compact') {
      expect(root.querySelector('ui-popover')).toBeNull();
      const dialog = root.querySelector('ui-sheet dialog');
      expect(dialog?.hasAttribute('open')).toBe(true);
      expect(dialog?.getAttribute('aria-label')).toBe('Status');
      expect(dialog?.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]')).toBeNull();
    } else {
      expect(root.querySelector('ui-sheet')).toBeNull();
    }

    const board = route === '/w/harbor/s/002' ? ['board'] : [];
    expect(rows(panel)).toEqual(['reading', 'widget', ...board, 'sep', `head:${live.services}`, 'no-services']);
    const reading = panel?.querySelector('[data-live-reading]') ?? null;
    expect(reading?.querySelector('.status-dot')).not.toBeNull();
    const count = route === '/' ? 2 : 1;
    expect(words(reading)).toBe((count === 1 ? live.reading.one : live.reading.other).replace('{{count}}', String(count)));

    const widget = panel?.querySelector('[data-live-widget]') ?? null;
    expect(widget?.tagName).toBe('BUTTON');
    expect(widget?.getAttribute('type')).toBe('button');
    expect(widget?.classList.contains('pop-item')).toBe(true);
    expect(words(widget)).toBe(lang === 'en' ? 'Open status widget' : 'Status-Widget öffnen');
    const icons = [...(widget?.querySelectorAll('ui-icon') ?? [])];
    expect(icons.map((icon) => icon.getAttribute('data-icon'))).toEqual(['app-window', 'external-link']);
    expect(icons.map((icon) => icon.classList.contains('go'))).toEqual([false, true]);
    // The one autofocus target is the widget button, the first row always present; the board link follows by Tab.
    expect([...(panel?.querySelectorAll('[data-autofocus]') ?? [])]).toEqual([widget]);
  });
});

/**
 * Spec 071 T23 (ISC-581): "Open status widget" opens `/widget` once, synchronously in the click, under the fixed window
 * name and without `noopener`, focuses the window, then closes the popover (focus back on the trigger) or the sheet.
 */
describe('ShellLive widget button (spec 071, ISC-581)', () => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const dialogProto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  const open = vi.fn<typeof window.open>();
  const focus = vi.fn();
  beforeEach(() => {
    proto['showPopover'] = vi.fn();
    proto['hidePopover'] = vi.fn();
    dialogProto['showModal'] = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    dialogProto['close'] = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    focus.mockClear();
    open.mockReset().mockImplementation(() => ({ focus }) as unknown as Window);
    vi.spyOn(window, 'open').mockImplementation(open);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete proto['showPopover'];
    delete proto['hidePopover'];
    delete dialogProto['showModal'];
    delete dialogProto['close'];
  });

  it.each(['medium', 'compact'] as const)('at %s opens the widget window once and closes the status overlay', async (tier) => {
    const root = await openPopover('en', 'activity', { ...SPEC_PAGE, tier });
    const trigger = root.querySelector<HTMLElement>('[data-control="live"]');
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    root.querySelector<HTMLButtonElement>('[data-live-widget]')?.click();
    // Synchronous: the window opened inside the click, before anything settled.
    expect(open).toHaveBeenCalledTimes(1);
    const [url, name, features] = open.mock.calls[0] ?? [];
    expect([url, name]).toEqual(['/widget', 'spectant-status']);
    expect(features).toMatch(/^popup,width=\d+,height=\d+/);
    expect(features).not.toMatch(/noopener|noreferrer/);
    expect(focus).toHaveBeenCalledTimes(1);

    await TestBed.inject(ApplicationRef).whenStable();
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    if (tier === 'compact') {
      expect(root.querySelector('ui-sheet dialog')?.hasAttribute('open')).toBe(false);
    } else {
      expect(document.activeElement).toBe(trigger);
    }
    expect(open).toHaveBeenCalledTimes(1);
  });
});
