import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { UiPriority } from './priority';

describe('UiPriority (ISC-118)', () => {
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

  async function render(value?: string | null) {
    const fixture = TestBed.createComponent(UiPriority);
    if (value !== undefined) fixture.componentRef.setInput('value', value);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const chip = host.querySelector<HTMLElement>('.chip');
    return { fixture, host, chip, icon: host.querySelector('ui-icon svg') };
  }

  it('shows P1 as chevrons-up with its text, in the fail tint and ink', async () => {
    const { host, chip, icon } = await render('P1');
    expect(chip?.textContent.trim()).toBe('P1');
    expect(chip?.getAttribute('role')).toBe('img');
    expect(chip?.getAttribute('aria-label')).toBe('priority P1');
    expect(chip?.getAttribute('title')).toBe('P1 · highest');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(host.style.getPropertyValue('--priority-tint')).toBe('var(--fail-t)');
    expect(host.style.getPropertyValue('--priority-ink')).toBe('var(--fail-ink)');
    expect(host.getAttribute('data-unmarked')).toBeNull();
  });

  it('gives every level its own glyph and look', async () => {
    const seen = new Set<string>();
    for (const [level, tint, ink] of [
      ['P2', 'color-mix(in oklch, var(--color-warning) 16%, var(--color-base-100))', 'var(--hover-ink)'],
      ['P3', 'transparent', 'var(--color-base-content)'],
      ['P4', 'transparent', 'var(--muted-ink)'],
    ] as const) {
      const { host, chip, icon } = await render(level);
      expect(chip?.textContent.trim()).toBe(level);
      expect(host.style.getPropertyValue('--priority-tint')).toBe(tint);
      expect(host.style.getPropertyValue('--priority-ink')).toBe(ink);
      seen.add(icon?.innerHTML ?? '');
    }
    expect(seen.size).toBe(3);
  });

  it('renders a missing value as P3, marked unmarked, and keeps the text when the language changes', async () => {
    const { fixture, host, chip } = await render(null);
    expect(host.getAttribute('data-level')).toBe('P3');
    expect(host.getAttribute('data-unmarked')).toBe('');
    expect(chip?.textContent.trim()).toBe('P3');
    expect(chip?.getAttribute('title')).toBe('P3 · no priority key, read as P3');

    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();
    expect(chip?.getAttribute('aria-label')).toBe('Priorität P3');
    expect(chip?.textContent.trim()).toBe('P3');

    const absent = await render();
    expect(absent.host.getAttribute('data-level')).toBe('P3');
  });
});
