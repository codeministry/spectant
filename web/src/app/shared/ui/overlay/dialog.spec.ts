import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { UiDialog } from './dialog';

// jsdom has no `showModal()` / `close()`: both are stubbed on the prototype the way a browser behaves (`open`
// reflects, `close()` fires `close`). Top layer, inertness and the backdrop are checked on real browsers (T28/T31).

@Component({
  imports: [UiDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button id="opener" type="button" (click)="open.set(true)">Open</button>
    <ui-dialog [(open)]="open" heading="Keyboard shortcuts">
      <p id="content">Body</p>
      <button id="inside" type="button">Inside</button>
    </ui-dialog>
  `,
})
class Host {
  readonly open = signal(false);
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
  const openFromButton = async () => {
    el('#opener').focus();
    el('#opener').click();
    await fixture.whenStable();
  };
  return { fixture, el, dialog: () => el('dialog') as HTMLDialogElement, openFromButton };
}

describe('UiDialog', () => {
  let api: ReturnType<typeof stubDialogApi>;

  beforeEach(() => {
    api = stubDialogApi();
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

  afterEach(() => {
    const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
    delete proto['showModal'];
    delete proto['close'];
  });

  it('opens as a modal native dialog named by its heading', async () => {
    const { dialog, el, openFromButton } = await render();
    expect(dialog().hasAttribute('open')).toBe(false);

    await openFromButton();

    expect(api.showModal).toHaveBeenCalledTimes(1);
    expect(dialog().hasAttribute('open')).toBe(true);
    const labelledBy = dialog().getAttribute('aria-labelledby') ?? '';
    expect(el(`#${labelledBy}`).textContent.trim()).toBe('Keyboard shortcuts');
    expect(el('#content').closest('dialog')).toBe(dialog());
  });

  it('closes on Esc, reports it through the open model and returns focus to the opener', async () => {
    const { fixture, dialog, el, openFromButton } = await render();
    await openFromButton();
    el('#inside').focus();

    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    el('#inside').dispatchEvent(esc);
    await fixture.whenStable();

    expect(esc.defaultPrevented).toBe(true);
    expect(fixture.componentInstance.open()).toBe(false);
    expect(dialog().hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(el('#opener'));
  });

  it('closes on a backdrop click but not on a click inside', async () => {
    const { fixture, dialog, el, openFromButton } = await render();
    await openFromButton();

    el('#content').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    el('#content').click();
    await fixture.whenStable();
    expect(fixture.componentInstance.open()).toBe(true);

    dialog().dispatchEvent(new Event('pointerdown', { bubbles: true }));
    dialog().click();
    await fixture.whenStable();
    expect(fixture.componentInstance.open()).toBe(false);
    expect(api.close).toHaveBeenCalled();
  });

  it('closes from the translated close button', async () => {
    const { fixture, el, openFromButton } = await render();
    await openFromButton();
    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();

    const close = el('button[aria-label]');
    expect(close.getAttribute('aria-label')).toBe('Schließen');
    close.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.open()).toBe(false);
    expect(document.activeElement).toBe(el('#opener'));
  });

  it('closes when the open model is set to false by the consumer', async () => {
    const { fixture, dialog, openFromButton } = await render();
    await openFromButton();

    fixture.componentInstance.open.set(false);
    await fixture.whenStable();

    expect(api.close).toHaveBeenCalledTimes(1);
    expect(dialog().hasAttribute('open')).toBe(false);
  });
});
