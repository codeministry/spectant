import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import de from '../../../../i18n/de.json';
import en from '../../../../i18n/en.json';
import { FavoritesSelect } from './favorites-select';

type Lang = 'en' | 'de';

/** The favourites select alone, in one catalogue; the list (T10) is not part of it yet. */
async function mount(lang: Lang): Promise<{ root: HTMLElement; select: FavoritesSelect; stable: () => Promise<void> }> {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: { en, de },
        translocoConfig: { availableLangs: ['en', 'de'], defaultLang: lang },
        preloadLangs: true,
      }),
    ],
  });
  const fixture = TestBed.createComponent(FavoritesSelect);
  await fixture.whenStable();
  return { root: fixture.nativeElement as HTMLElement, select: fixture.componentInstance, stable: () => fixture.whenStable() };
}

const trigger = (root: Element): HTMLButtonElement => {
  const button = root.querySelector<HTMLButtonElement>('button[data-control="favorites"]');
  if (button === null) throw new Error('no favorites trigger');
  return button;
};

const CATALOGUES: ReadonlyArray<readonly [Lang, string]> = [
  ['en', en.shell.favorites.trigger],
  ['de', de.shell.favorites.trigger],
];

describe('FavoritesSelect trigger (spec 069, ISC-553)', () => {
  for (const [lang, name] of CATALOGUES) {
    it(`${lang}: shows only the star, named from the catalogue, aria-expanded false closed and true open`, async () => {
      const { root, select, stable } = await mount(lang);
      const button = trigger(root);

      expect(name.length).toBeGreaterThan(0);
      expect(button.textContent.trim()).toBe('');
      const icons = button.querySelectorAll('ui-icon');
      expect(icons.length).toBe(1);
      expect(icons.item(0).getAttribute('data-icon')).toBe('star');
      expect(button.getAttribute('aria-label')).toBe(name);
      expect(button.getAttribute('aria-haspopup')).toBe('dialog');
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(select.open()).toBe(false);

      button.click();
      await stable();
      expect(select.open()).toBe(true);
      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(button.textContent.trim()).toBe('');
      expect(select.anchor()).toBe(button);

      button.click();
      await stable();
      expect(button.getAttribute('aria-expanded')).toBe('false');
    });
  }

  it('the two catalogues name the trigger differently (en "Favorites", de formal)', () => {
    expect(en.shell.favorites.trigger).not.toBe(de.shell.favorites.trigger);
  });
});
