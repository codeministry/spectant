import { signal } from '@angular/core';
import { DeferBlockBehavior, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import de from '../../../i18n/de.json';
import en from '../../../i18n/en.json';
import { LockSourceService } from '../../core/lock-source.service';
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

/**
 * Opens the header's status popover alone in `lang` under lock source `source`: a route-only `ShellState` on harbor,
 * a `ShellData` without services, a stub `RefreshService`; the popover's `showPopover` is stubbed, as the DOM has none.
 */
async function openPopover(lang: Lang, source: Source): Promise<HTMLElement> {
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
      { provide: ShellState, useValue: { ws: signal('harbor') } },
      { provide: ShellData, useValue: { workspaceList: signal([{ slug: 'harbor' }]), dashboard: { value: signal(undefined) } } },
      { provide: RefreshService, useValue: { lastRefresh: signal(0), refresh: () => undefined } },
    ],
    deferBlockBehavior: DeferBlockBehavior.Playthrough,
  });
  TestBed.inject(LockSourceService).connect(signal({ lockSource: source, lock: null, agentsWorking: 0 }));
  const fixture = TestBed.createComponent(ShellLive);
  fixture.componentRef.setInput('link', ['/w', 'harbor', 's', '002', 'board']);
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
