import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { HelpNav } from './help-nav';
import { HELP_SECTIONS } from '../../features/help/help-sections';
import type { HelpSection } from './help-nav';

/** A page stand-in: the nav over one section per entry, each with its focusable heading. */
@Component({
  imports: [HelpNav],
  template: `
    <app-help-nav [sections]="sections()" />
    @for (section of sections(); track section.id) {
      <section [id]="section.id"><h2 [id]="section.heading" tabindex="-1">{{ section.id }}</h2></section>
    }
  `,
})
class Host {
  readonly sections = signal<readonly HelpSection[]>(HELP_SECTIONS);
}

/** A hand-driven IntersectionObserver: the spec reports which sections enter or leave the band. */
class FakeObserver {
  static last: FakeObserver | null = null;
  readonly observed: Element[] = [];
  disconnected = false;
  constructor(readonly callback: IntersectionObserverCallback) {
    FakeObserver.last = this;
  }
  observe(target: Element): void {
    this.observed.push(target);
  }
  unobserve(): void {
    // The nav never unobserves a single section; it disconnects on destroy.
  }
  disconnect(): void {
    this.disconnected = true;
  }
  report(entries: ReadonlyArray<{ id: string; in: boolean }>): void {
    const records = entries.map((e) => ({ target: document.getElementById(e.id), isIntersecting: e.in }) as unknown as IntersectionObserverEntry);
    this.callback(records, this as unknown as IntersectionObserver);
  }
}

async function mount() {
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
  const fixture = TestBed.createComponent(Host);
  document.body.append(fixture.nativeElement as HTMLElement);
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, root: fixture.nativeElement as HTMLElement };
}

const chips = (root: HTMLElement) => [...root.querySelectorAll<HTMLAnchorElement>('nav[data-help-nav] a[data-help-chip]')];
const current = (root: HTMLElement) => chips(root).filter((chip) => chip.getAttribute('aria-current') === 'true').map((chip) => chip.dataset['helpChip']);

describe('HelpNav (T162, ISC-133.1)', () => {
  beforeEach(() => {
    FakeObserver.last = null;
    vi.stubGlobal('IntersectionObserver', FakeObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('renders one chip per section, in order, each a same-page link to the section id', async () => {
    const { root } = await mount();
    const nav = root.querySelector('nav[data-help-nav]');
    expect(nav?.getAttribute('aria-label')).toBe('Sections');
    expect(chips(root).map((chip) => chip.dataset['helpChip'])).toEqual(['about', 'moves', 'workflows', 'commands', 'glossary', 'start', 'keys']);
    expect(chips(root).map((chip) => chip.textContent.trim())).toEqual([
      'About',
      'How a spec moves',
      'Workflows',
      'Commands',
      'Glossary',
      'Getting started',
      'Keyboard',
    ]);
    for (const chip of chips(root)) expect(chip.getAttribute('href')).toMatch(new RegExp(`#${chip.dataset['helpChip'] ?? ''}$`));
  });

  it('marks the first section current before anything scrolls, then the section in view', async () => {
    const { fixture, root } = await mount();
    expect(current(root)).toEqual(['about']);
    expect(FakeObserver.last?.observed.map((el) => el.id)).toEqual(HELP_SECTIONS.map((s) => s.id));

    FakeObserver.last?.report([{ id: 'about', in: false }, { id: 'commands', in: true }]);
    fixture.detectChanges();
    expect(current(root)).toEqual(['commands']);

    // Two sections in the band: the earlier one is current; once it leaves, the later one.
    FakeObserver.last?.report([{ id: 'glossary', in: true }]);
    fixture.detectChanges();
    expect(current(root)).toEqual(['commands']);
    FakeObserver.last?.report([{ id: 'commands', in: false }]);
    fixture.detectChanges();
    expect(current(root)).toEqual(['glossary']);

    // Nothing in the band (between two long sections): the last current stays.
    FakeObserver.last?.report([{ id: 'glossary', in: false }]);
    fixture.detectChanges();
    expect(current(root)).toEqual(['glossary']);
  });

  it('moves focus to the section heading on a chip, as a g section jump does', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { fixture, root } = await mount();
    const chip = chips(root).find((c) => c.dataset['helpChip'] === 'glossary');
    chip?.click();
    await fixture.whenStable();
    expect(document.activeElement?.id).toBe('help-glossary');
    expect(scroll).toHaveBeenCalled();
    expect(scroll.mock.contexts.at(-1)).toBe(document.getElementById('glossary'));
    expect(current(root)).toEqual(['glossary']);
  });

  it('disconnects the observer when the page goes', async () => {
    const { fixture } = await mount();
    const observer = FakeObserver.last;
    fixture.destroy();
    expect(observer?.disconnected).toBe(true);
  });
});
