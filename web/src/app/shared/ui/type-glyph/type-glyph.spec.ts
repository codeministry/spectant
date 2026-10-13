import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { TYPE_GLYPHS, type TypeGlyphKind, UiTypeGlyph } from './type-glyph';

describe('UiTypeGlyph (ISC-129)', () => {
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

  async function render(type: TypeGlyphKind, inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(UiTypeGlyph);
    fixture.componentRef.setInput('type', type);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    await fixture.whenStable();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  it('maps each spec type and idea to its own Lucide icon, the prototype CHIP_ICON where it names one', () => {
    expect(TYPE_GLYPHS).toEqual({
      feature: 'sparkles',
      bug: 'bug',
      refactor: 'shuffle',
      spike: 'flask-conical',
      infra: 'server',
      project: 'folder-kanban',
      chore: 'brush-cleaning',
      idea: 'lightbulb',
    });
    expect(new Set(Object.values(TYPE_GLYPHS)).size).toBe(8);
  });

  it('draws the icon as an image named by the translated type word', async () => {
    const { host } = await render('chore');
    const svg = host.querySelector('svg');
    expect(host.getAttribute('data-type')).toBe('chore');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('chore');
    expect(svg?.getAttribute('width')).toBe('16');
    expect(svg?.innerHTML).toContain('<path');
  });

  it('labels idea and follows the active language', async () => {
    const { fixture, host } = await render('idea');
    expect(host.querySelector('svg')?.getAttribute('aria-label')).toBe('idea');
    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();
    expect(host.querySelector('svg')?.getAttribute('aria-label')).toBe('Idee');
  });

  it('is decorative when the word stands beside it, and takes the ui-glyph sizes', async () => {
    const { host } = await render('bug', { decorative: true, size: 20 });
    const svg = host.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('aria-label')).toBeNull();
    expect(svg?.getAttribute('width')).toBe('20');
  });
});
