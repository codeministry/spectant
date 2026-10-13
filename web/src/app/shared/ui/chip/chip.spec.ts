import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import en from '../../../../i18n/en.json';
import { UiIcon } from '../../icons/icon';
import { UiChip } from './chip';

describe('UiChip', () => {
  it('takes its tint and ink from the tone and shows a dot on request', async () => {
    const fixture = TestBed.createComponent(UiChip);
    fixture.componentRef.setInput('tone', 'secondary');
    fixture.componentRef.setInput('dot', true);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.style.getPropertyValue('--chip-tint')).toBe('var(--ques-t)');
    expect(host.style.getPropertyValue('--chip-ink')).toBe('var(--ques-ink)');
    expect(host.querySelector('.dot')).not.toBeNull();
  });

  it('paints the dot in the tone mark, the contrast-safe success mark on success (ISC-65)', async () => {
    const fixture = TestBed.createComponent(UiChip);
    fixture.componentRef.setInput('tone', 'success');
    fixture.componentRef.setInput('dot', true);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.style.getPropertyValue('--chip-color')).toBe('var(--done-mark)');
  });

  it('renders the demo variant as the yellow mark of a mocked block: flask, lower-case word, description (ISC-149.1)', async () => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
          preloadLangs: true,
        }),
      ],
    });
    const fixture = TestBed.createComponent(UiChip);
    fixture.componentRef.setInput('variant', 'demo');
    fixture.componentRef.setInput('tone', 'error');
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.hasAttribute('data-demo-chip')).toBe(true);
    expect(host.style.getPropertyValue('--chip-tint')).toBe('var(--conc-t)');
    expect(host.style.getPropertyValue('--chip-ink')).toBe('var(--conc-text)');
    expect((fixture.debugElement.query(By.directive(UiIcon)).componentInstance as UiIcon).name()).toBe('flask-conical');
    expect(host.querySelector('.visually-hidden')?.textContent.trim()).toBe(en.demo.description);
    expect(host.textContent.replace(en.demo.description, '').trim()).toBe('demo');
  });

  it('carries no demo hook outside the demo variant', async () => {
    const fixture = TestBed.createComponent(UiChip);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).hasAttribute('data-demo-chip')).toBe(false);
  });
});
