import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { UiStarToggle } from './star-toggle';

// Spec 052 T14 (ISC-300): the attribute and event contract of the favorite toggle. The look (32 / 28 px box, the
// coarse-pointer hit area, outline versus fill, forced colours) needs a cascade jsdom does not have; the e2e group
// `toggle` and the browser tier see it.

@Component({
  imports: [UiStarToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button ui-star-toggle id="star" [pressed]="pressed()" [label]="label()" [size]="size()" (toggled)="toggles.set(toggles() + 1)"></button>
  `,
})
class Host {
  readonly pressed = signal(false);
  readonly label = signal('Favorite: 052 Spec favorites');
  readonly size = signal<'sm' | 'head'>('sm');
  readonly toggles = signal(0);
}

describe('UiStarToggle (ISC-300)', () => {
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

  async function render() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const star = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('#star');
    if (!star) throw new Error('#star missing');
    return { fixture, host: fixture.componentInstance, star };
  }

  it('is a native button with the 16 px star, a fixed name, aria-pressed false and the add action as title', async () => {
    const { star } = await render();

    expect(star.tagName).toBe('BUTTON');
    expect(star.getAttribute('type')).toBe('button');
    expect(star.getAttribute('aria-label')).toBe('Favorite: 052 Spec favorites');
    expect(star.getAttribute('aria-pressed')).toBe('false');
    expect(star.getAttribute('title')).toBe('Add to favorites');
    expect(star.dataset['size']).toBe('sm');
    const icon = star.querySelector('ui-icon');
    expect(icon?.getAttribute('data-icon')).toBe('star');
    expect(icon?.querySelector('svg')?.getAttribute('width')).toBe('16');
    expect(icon?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('carries the state in aria-pressed and the title only, never in the accessible name', async () => {
    const { fixture, host, star } = await render();

    host.pressed.set(true);
    await fixture.whenStable();

    expect(star.getAttribute('aria-pressed')).toBe('true');
    expect(star.getAttribute('title')).toBe('Remove from favorites');
    expect(star.getAttribute('aria-label')).toBe('Favorite: 052 Spec favorites');
  });

  it('emits toggled once per click and leaves the state to the caller', async () => {
    const { fixture, host, star } = await render();

    star.click();
    await fixture.whenStable();

    expect(host.toggles()).toBe(1);
    expect(star.getAttribute('aria-pressed')).toBe('false');
  });

  it('marks the compact spec-head box with data-size="head"', async () => {
    const { fixture, host, star } = await render();

    host.size.set('head');
    await fixture.whenStable();

    expect(star.dataset['size']).toBe('head');
  });

  it('names the action in the active language', async () => {
    const { fixture, host, star } = await render();

    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();
    expect(star.getAttribute('title')).toBe('Zu den Favoriten hinzufügen');

    host.pressed.set(true);
    await fixture.whenStable();
    expect(star.getAttribute('title')).toBe('Aus den Favoriten entfernen');
  });
});
