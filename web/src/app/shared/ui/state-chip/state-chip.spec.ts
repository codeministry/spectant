import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { UiStateChip } from './state-chip';

describe('UiStateChip', () => {
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

  async function render(state: string, family?: 'card' | 'claim') {
    const fixture = TestBed.createComponent(UiStateChip);
    fixture.componentRef.setInput('state', state);
    if (family) fixture.componentRef.setInput('family', family);
    await fixture.whenStable();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  it('shows the glyph and the translated state word as visible text, tinted by the state tone', async () => {
    const { host } = await render('concerns');
    const chip = host.querySelector<HTMLElement>('ui-chip');

    expect(host.querySelector('ui-glyph svg[data-state="concerns"]')).not.toBeNull();
    expect(host.textContent.trim()).toBe('concerns');
    expect(chip?.getAttribute('data-tone')).toBe('concern');
    expect(chip?.style.getPropertyValue('--chip-ink')).toBe('var(--conc-ink)');
  });

  it('follows the active language and keeps the two closed words apart', async () => {
    const { fixture, host } = await render('running');
    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();
    expect(host.textContent.trim()).toBe('in Arbeit');

    const claim = await render('closed', 'claim');
    expect(claim.host.getAttribute('data-family')).toBe('claim');
    expect(claim.host.querySelector('ui-glyph')?.getAttribute('data-shape')).toBe('disc');
  });
});
