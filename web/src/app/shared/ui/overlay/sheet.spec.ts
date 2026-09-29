import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { type SheetTier, UiSheet } from './sheet';

// jsdom has no `showModal()` / `close()`; they are stubbed as in dialog.spec.ts. The side / bottom geometry, the
// 75dvh cap and the slide are checked on real browsers (T28/T31); here the tier contract and the focus rules.

@Component({
  imports: [UiSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button id="opener" type="button" (click)="open.set(true)">Sort</button>
    <ui-sheet [(open)]="open" [tier]="tier()" heading="Sort">
      <button id="inside" type="button">Stage order</button>
    </ui-sheet>
    <ui-sheet id="custom" tier="compact" label="Spec">
      <span uiSheetHandle id="custom-handle"></span>
    </ui-sheet>
  `,
})
class Host {
  readonly open = signal(false);
  readonly tier = signal<SheetTier>('compact');
}

function stubDialogApi(): { showModal: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } {
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  const showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  const close = vi.fn(function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  });
  proto['showModal'] = showModal;
  proto['close'] = close;
  return { showModal, close };
}

async function render() {
  const fixture = TestBed.createComponent(Host);
  document.body.appendChild(fixture.nativeElement as HTMLElement);
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const el = (selector: string): HTMLElement =>
    root.querySelector<HTMLElement>(selector) ?? (() => { throw new Error(`${selector} missing`); })();
  return { fixture, el, root, sheet: () => el('ui-sheet:not(#custom)') };
}

describe('UiSheet', () => {
  let api: ReturnType<typeof stubDialogApi>;

  beforeEach(() => {
    api = stubDialogApi();
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
          preloadLangs: true,
        }),
      ],
    });
  });

  afterEach(() => {
    const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
    delete proto['showModal'];
    delete proto['close'];
  });

  it('is a bottom sheet with a grab handle at compact and a side sheet without one at medium', async () => {
    const { fixture, sheet } = await render();

    expect(sheet().dataset['tier']).toBe('compact');
    expect(sheet().querySelector('dialog .handle')).not.toBeNull();

    fixture.componentInstance.tier.set('medium');
    await fixture.whenStable();

    expect(sheet().dataset['tier']).toBe('medium');
    expect(sheet().querySelector('dialog .handle')).toBeNull();
  });

  it('projects a custom grab handle into the handle slot', async () => {
    const { el } = await render();

    expect(el('#custom #custom-handle').closest('dialog')).not.toBeNull();
    expect(el('#custom').querySelector('.handle')).toBeNull();
    expect(el('#custom dialog').getAttribute('aria-label')).toBe('Spec');
  });

  it('opens modally and closes on Esc with focus back on the opener', async () => {
    const { fixture, el } = await render();
    el('#opener').focus();
    el('#opener').click();
    await fixture.whenStable();
    expect(api.showModal).toHaveBeenCalledTimes(1);

    el('#inside').focus();
    el('#inside').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await fixture.whenStable();

    expect(fixture.componentInstance.open()).toBe(false);
    expect(api.close).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(el('#opener'));
  });

  it('closes on a backdrop click', async () => {
    const { fixture, el, sheet } = await render();
    el('#opener').click();
    await fixture.whenStable();

    const dialog = sheet().querySelector('dialog') ?? (() => { throw new Error('dialog missing'); })();
    dialog.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    dialog.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.open()).toBe(false);
  });
});
