import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import type { StatusSpec } from '../../../../../server/src/contracts/status.contract';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { StatusWidgetRow } from './status-widget-row';

// Spec 071 (T28, ISC-585): one widget row shows the spec number, the title with its full text in `title`, the
// text-less ring as a progressbar, the closed/total counter and the stage chip with its catalogue word and tone; the
// whole row links to the spec.

const OPEN: StatusSpec = {
  id: '012',
  slug: '012-harbor-console',
  title: 'Harbor console with a very long title that ends in an ellipsis',
  stage: 'build',
  claims: { closed: 3, total: 9 },
  closedAt: null,
  state: 'open',
  archived: false,
  nextCommand: '/spec implement 012',
};

const CLOSED: StatusSpec = {
  id: '007',
  slug: '007-audit-trail',
  title: 'Audit trail',
  stage: 'done',
  claims: { closed: 6, total: 6 },
  closedAt: '2026-10-23T08:00:00.000Z',
  state: 'done',
  archived: true,
  nextCommand: null,
};

const COPY = {
  en: { build: 'Build', done: 'Done', closedOpen: '3 of 9 claims closed', closedDone: '6 of 6 claims closed' },
  de: { build: 'Bauen', done: 'Fertig', closedOpen: '3 von 9 Claims geschlossen', closedDone: '6 von 6 Claims geschlossen' },
} as const;

async function render(spec: StatusSpec, lang: 'en' | 'de'): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    imports: [TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' }, preloadLangs: true })],
  });
  TestBed.inject(TranslocoService).setActiveLang(lang);
  const fixture = TestBed.createComponent(StatusWidgetRow);
  fixture.componentRef.setInput('spec', spec);
  fixture.componentRef.setInput('ws', 'harbor');
  fixture.componentRef.setInput('pathTail', 'harbor');
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('StatusWidgetRow (spec 071, T28, ISC-585)', () => {
  afterEach(() => TestBed.resetTestingModule());

  for (const lang of ['en', 'de'] as const) {
    it(`an open spec shows number, title, ring, counter and stage chip (${lang})`, async () => {
      const host = await render(OPEN, lang);
      const link = host.querySelector('a.entry-link') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('/w/harbor/s/012');
      expect(host.querySelector('.entry-id')?.textContent.trim()).toBe('012');
      const title = host.querySelector('.entry-title') as HTMLElement;
      expect(title.textContent.trim()).toBe(OPEN.title);
      expect(title.getAttribute('title')).toBe(OPEN.title);

      const ring = host.querySelector('ui-ring') as HTMLElement;
      expect(ring.getAttribute('role')).toBe('progressbar');
      expect(ring.getAttribute('aria-valuenow')).toBe('33');
      expect(ring.getAttribute('aria-label')).toBe(COPY[lang].closedOpen);
      expect(ring.hasAttribute('data-full')).toBe(false);

      expect(host.querySelector('.entry-count')?.textContent.trim()).toBe('3/9');
      const chip = host.querySelector('ui-chip.entry-stage') as HTMLElement;
      expect(chip.textContent.trim()).toBe(COPY[lang].build);
      expect(chip.getAttribute('data-tone')).toBe('primary');
      expect(chip.querySelector('.dot')).not.toBeNull();

      // Spec 072 (T11): ring, number, counter and stage are aria-hidden siblings of the title link, whose name still
      // names them; the ring keeps its own progressbar attributes (the 071 pins above stay).
      for (const sel of ['.entry-ring', '.entry-id', '.entry-count', 'ui-chip.entry-stage']) {
        expect(host.querySelector(sel)?.getAttribute('aria-hidden')).toBe('true');
        expect(link.contains(host.querySelector(sel))).toBe(false);
      }
      expect(link.contains(title)).toBe(true);

      const name = link.getAttribute('aria-label') ?? '';
      expect(name.startsWith(`012 ${OPEN.title}`)).toBe(true);
      expect(name).toContain(COPY[lang].closedOpen);
      expect(name).toContain(COPY[lang].build);
    });

    it(`a closed spec shows the full lime ring and the done chip in its own tone (${lang})`, async () => {
      const host = await render(CLOSED, lang);
      expect((host.querySelector('a.entry-link') as HTMLAnchorElement).getAttribute('href')).toBe('/w/harbor/s/007');
      expect(host.querySelector('.entry-id')?.textContent.trim()).toBe('007');
      expect(host.querySelector('.entry-title')?.getAttribute('title')).toBe('Audit trail');

      const ring = host.querySelector('ui-ring') as HTMLElement;
      expect(ring.getAttribute('aria-valuenow')).toBe('100');
      expect(ring.hasAttribute('data-full')).toBe(true);
      expect(ring.getAttribute('aria-label')).toBe(COPY[lang].closedDone);

      expect(host.querySelector('.entry-count')?.textContent.trim()).toBe('6/6');
      const chip = host.querySelector('ui-chip.entry-stage') as HTMLElement;
      expect(chip.textContent.trim()).toBe(COPY[lang].done);
      expect(chip.getAttribute('data-tone')).toBe('success');
    });
  }

  it('a spec without claims leaves the ring without a value', async () => {
    const host = await render({ ...OPEN, claims: { closed: 0, total: 0 } }, 'en');
    const ring = host.querySelector('ui-ring') as HTMLElement;
    expect(ring.hasAttribute('aria-valuenow')).toBe(false);
    expect(host.querySelector('.entry-count')?.textContent.trim()).toBe('0/0');
  });
});

// Spec 071 (T29, ISC-594): a spec with an open agent run carries the decorative agent dot at the ring's corner and
// "agent running" in its row's name; one without a run carries neither. The dot stands still under reduced motion
// through the primitive's own rule (`ui-agent-dot`), which this row adds nothing to.
describe('StatusWidgetRow agent run (spec 071, T29, ISC-594)', () => {
  afterEach(() => TestBed.resetTestingModule());

  const RUNNING = { en: 'agent running', de: 'Agent läuft' } as const;

  for (const lang of ['en', 'de'] as const) {
    it(`a running spec shows the agent dot at its ring and names the run (${lang})`, async () => {
      const host = await render({ ...OPEN, state: 'running' }, lang);
      const dot = host.querySelector('.entry-ring ui-agent-dot') as HTMLElement;
      expect(dot).not.toBeNull();
      expect(dot.getAttribute('aria-hidden')).toBe('true');
      expect(host.querySelector('a.entry-link')?.getAttribute('aria-label')).toContain(RUNNING[lang]);
    });

    it(`a spec without a run shows no dot and no run in its name (${lang})`, async () => {
      for (const spec of [OPEN, CLOSED, { ...OPEN, state: null }]) {
        const host = await render(spec, lang);
        expect(host.querySelector('ui-agent-dot')).toBeNull();
        expect(host.querySelector('a.entry-link')?.getAttribute('aria-label')).not.toContain(RUNNING[lang]);
        TestBed.resetTestingModule();
      }
    });
  }
});

/** The puts-back of every window stub of the running test, undone in reverse order. */
const restores: Array<() => void> = [];

/** Replaces one property of `window` for the running test. */
function stubWindow(key: 'opener' | 'outerWidth', value: unknown): void {
  const original = Object.getOwnPropertyDescriptor(window, key);
  Object.defineProperty(window, key, { configurable: true, value });
  restores.push(() => {
    if (original) Object.defineProperty(window, key, original);
    else Reflect.deleteProperty(window, key);
  });
}

interface FakeOpener {
  readonly closed: boolean;
  readonly postMessage: ReturnType<typeof vi.fn>;
  readonly focus: ReturnType<typeof vi.fn>;
}

const fakeOpener = (closed = false): FakeOpener => ({ closed, postMessage: vi.fn(), focus: vi.fn() });

/** Renders a row with a router in a window `outerWidth` wide on a screen 1440 px wide, opened by `opener`. */
async function renderClickable(opener: FakeOpener | null, outerWidth: number) {
  stubWindow('opener', opener);
  stubWindow('outerWidth', outerWidth);
  vi.spyOn(window.screen, 'availWidth', 'get').mockReturnValue(1440);
  TestBed.configureTestingModule({
    imports: [TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' }, preloadLangs: true })],
    providers: [provideRouter([])],
  });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  const fixture = TestBed.createComponent(StatusWidgetRow);
  fixture.componentRef.setInput('spec', OPEN);
  fixture.componentRef.setInput('ws', 'fleet yard');
  fixture.componentRef.setInput('pathTail', 'fleet-yard');
  await fixture.whenStable();
  const link = (fixture.nativeElement as HTMLElement).querySelector('a.entry-link') as HTMLAnchorElement;
  return { link, navigate, open };
}

/** Clicks the link with a cancelable click; true when the row prevented the native navigation. */
function click(link: HTMLAnchorElement, init: MouseEventInit = {}): boolean {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  link.dispatchEvent(event);
  return event.defaultPrevented;
}

const TARGET = '/w/fleet%20yard/s/012';

function cleanUp(): void {
  while (restores.length > 0) restores.pop()?.();
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
}

// Spec 071 (T31, ISC-586): in popup mode a row click hands the target to the app window that opened the widget, as
// one `spectant:navigate` message to the own origin, then brings that window to the front; the widget stays put.
describe('StatusWidgetRow click in popup mode (spec 071, T31, ISC-586)', () => {
  afterEach(cleanUp);

  it('posts exactly one navigate message to the opener at the own origin, focuses it and does not navigate itself', async () => {
    const opener = fakeOpener();
    const { link, navigate, open } = await renderClickable(opener, 480);
    expect(click(link)).toBe(true);
    expect(opener.postMessage).toHaveBeenCalledTimes(1);
    expect(opener.postMessage).toHaveBeenCalledWith({ type: 'spectant:navigate', url: TARGET }, window.location.origin);
    expect(opener.focus).toHaveBeenCalledTimes(1);
    expect(opener.postMessage.mock.invocationCallOrder[0]).toBeLessThan(opener.focus.mock.invocationCallOrder[0]);
    expect(navigate).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  for (const [label, init] of [
    ['ctrl', { ctrlKey: true }],
    ['meta', { metaKey: true }],
    ['shift', { shiftKey: true }],
    ['middle', { button: 1 }],
  ] as const) {
    it(`leaves a ${label} click to the native link`, async () => {
      const opener = fakeOpener();
      const { link, navigate } = await renderClickable(opener, 480);
      expect(click(link, init)).toBe(false);
      expect(opener.postMessage).not.toHaveBeenCalled();
      expect(opener.focus).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    });
  }
});

// Spec 071 (T32, ISC-586.1): as a tab (as wide as the screen), without an opener or with a closed one, a row click
// navigates the widget's own tab: no message, no new window.
describe('StatusWidgetRow click in tab mode or without an app window (spec 071, T32, ISC-586.1)', () => {
  afterEach(cleanUp);

  for (const [label, opener, outerWidth] of [
    ['tab mode with an open opener', fakeOpener(), 1440],
    ['no opener', null, 480],
    ['a closed opener', fakeOpener(true), 480],
  ] as const) {
    it(`navigates its own tab with ${label}`, async () => {
      const { link, navigate, open } = await renderClickable(opener, outerWidth);
      expect(click(link)).toBe(true);
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith(TARGET);
      expect(open).not.toHaveBeenCalled();
      expect(opener?.postMessage.mock.calls.length ?? 0).toBe(0);
      expect(opener?.focus.mock.calls.length ?? 0).toBe(0);
    });
  }
});

// Spec 072 (T11, T12, ISC-600): a row with a `nextCommand` shows it in a second line as a copy chip whose click writes
// exactly the command to the clipboard and whose name says "copy" and the command in both catalogues, with the
// workspace's path tail as context; a row without one has neither chip nor an empty second line.
describe('StatusWidgetRow command chip (spec 072, T11, ISC-600)', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
    TestBed.resetTestingModule();
  });

  const NAME = { en: 'Copy /spec implement 012 · harbor', de: '/spec implement 012 kopieren · harbor' } as const;

  for (const lang of ['en', 'de'] as const) {
    it(`a row with a next command copies exactly that command from its chip (${lang})`, async () => {
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const host = await render(OPEN, lang);
      const line = host.querySelector('.entry > .entry-cmd') as HTMLElement;
      expect(line).not.toBeNull();
      expect(host.querySelector('a.entry-link')?.contains(line)).toBe(false);
      const chips = line.querySelectorAll('ui-command-chip');
      expect(chips.length).toBe(1);
      expect(chips[0].hasAttribute('data-icon-only')).toBe(false);
      expect(chips[0].querySelector('code')?.textContent.trim()).toBe('/spec implement 012');

      const button = chips[0].querySelector('button.copy') as HTMLButtonElement;
      expect(button.querySelector('ui-icon')).not.toBeNull();
      expect(button.getAttribute('aria-label')).toBe(NAME[lang]);
      expect(button.getAttribute('title')).toBe(NAME[lang].split(' · ')[0]);

      button.click();
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      expect(writeText).toHaveBeenCalledWith('/spec implement 012');
    });

    it(`a row without a next command has no chip and no second command line (${lang})`, async () => {
      const host = await render(CLOSED, lang);
      expect(host.querySelectorAll('ui-command-chip').length).toBe(0);
      expect(host.querySelector('.entry-cmd')).toBeNull();
    });
  }
});
