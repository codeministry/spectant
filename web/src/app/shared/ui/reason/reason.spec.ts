import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { UiReason } from './reason';

describe('UiReason (ISC-122.3)', () => {
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

  async function render(inputs: Record<string, unknown>) {
    const fixture = TestBed.createComponent(UiReason);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    await fixture.whenStable();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  const phrase = 'ISC-334 is takeable, and the reviewed mark is fresh for the current spec and plan';

  it('shows the hourglass, the phrase exactly as given and the command chip', async () => {
    const { host } = await render({ phrase, command: '/spec-review 008' });
    const icon = host.querySelector('ui-icon svg');
    expect(icon?.getAttribute('role')).toBe('img');
    expect(icon?.getAttribute('aria-label')).toBe('open');
    expect(host.querySelector('.phrase')?.textContent).toBe(phrase);
    expect(host.querySelector('.visually-hidden')?.textContent).toBe(phrase);
    expect(host.querySelector('ui-command-chip code')?.textContent).toBe('/spec-review 008');
    expect(host.querySelector('ui-command-chip button')?.getAttribute('aria-label')).toBe('Copy /spec-review 008');
  });

  it('renders no chip without a command, and clamps to two lines by default', async () => {
    const { host } = await render({ phrase: 'waits for 006 of F9' });
    expect(host.querySelector('ui-command-chip')).toBeNull();
    expect(host.getAttribute('data-compact')).toBeNull();
    expect(host.querySelector('.phrase')?.getAttribute('data-clamp')).toBe('whole');
  });

  it('keeps the phrase untranslated and the glyph label in the active language', async () => {
    const { fixture, host } = await render({ phrase, compact: true });
    expect(host.getAttribute('data-compact')).toBe('');
    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();
    expect(host.querySelector('ui-icon svg')?.getAttribute('aria-label')).toBe('offen');
    expect(host.querySelector('.phrase')?.textContent).toBe(phrase);
  });

  it('wraps the whole phrase unclamped in the block variant, read once', async () => {
    const { host } = await render({ phrase, command: '/spec-implement 002', block: true });
    expect(host.getAttribute('data-block')).toBe('');
    const shown = host.querySelector('.phrase');
    expect(shown?.textContent).toBe(phrase);
    expect(shown?.getAttribute('data-clamp')).toBeNull();
    expect(shown?.getAttribute('aria-hidden')).toBeNull();
    expect(host.querySelector('.visually-hidden')).toBeNull();
    expect(host.querySelector('ui-command-chip code')?.textContent).toBe('/spec-implement 002');
  });

  it('re-emits the copied command for the live region', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { fixture, host } = await render({ phrase, command: '/spec-complete 007' });
    const emitted: string[] = [];
    fixture.componentInstance.copied.subscribe((c) => emitted.push(c));
    host.querySelector<HTMLButtonElement>('ui-command-chip button')?.click();
    await fixture.whenStable();
    expect(emitted).toEqual(['/spec-complete 007']);
    Reflect.deleteProperty(navigator, 'clipboard');
  });
});
