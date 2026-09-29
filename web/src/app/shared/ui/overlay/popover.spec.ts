import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiPopover, UiPopoverTrigger } from './popover';

// jsdom has no Popover API and no layout: `showPopover` / `hidePopover` are stubbed on the prototype (hiding fires
// the `toggle` event a browser queues), and the trigger's rect is faked. Top layer, light dismiss and the anchored
// geometry are measured on real Chromium and WebKit by the browser tier (T28/T31).

@Component({
  imports: [UiPopover, UiPopoverTrigger],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button id="trigger" type="button" [uiPopoverTrigger]="pop">Open</button>
    <ui-popover #pop label="Settings" placement="end">
      <button id="inside" type="button">Inside</button>
    </ui-popover>
    <button id="elsewhere" type="button">Elsewhere</button>
  `,
})
class Host {}

@Component({
  imports: [UiPopover, UiPopoverTrigger],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button id="trigger" type="button" [uiPopoverTrigger]="pop">Open</button>
    <ui-popover #pop label="Areas">
      <a id="first" href="/a">First</a>
      <a id="current" href="/b" data-autofocus>Current</a>
    </ui-popover>
  `,
})
class AutofocusHost {}

interface Stubbed {
  showPopover: ReturnType<typeof vi.fn>;
  hidePopover: ReturnType<typeof vi.fn>;
}

function stubPopoverApi(): Stubbed {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const showPopover = vi.fn();
  const hidePopover = vi.fn(function (this: HTMLElement) {
    this.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'closed', oldState: 'open' }));
  });
  proto['showPopover'] = showPopover;
  proto['hidePopover'] = hidePopover;
  return { showPopover, hidePopover };
}

async function render() {
  const fixture = TestBed.createComponent(Host);
  document.body.appendChild(fixture.nativeElement as HTMLElement);
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const el = (selector: string): HTMLElement =>
    root.querySelector<HTMLElement>(selector) ?? (() => { throw new Error(`${selector} missing`); })();
  return { fixture, el, panel: () => el('[popover]') };
}

describe('UiPopover', () => {
  let api: Stubbed;

  beforeEach(() => {
    api = stubPopoverApi();
    vi.spyOn(CSS, 'supports').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    delete proto['showPopover'];
    delete proto['hidePopover'];
  });

  it('is a native auto popover, wired to its trigger with aria-expanded and aria-controls', async () => {
    const { el, panel } = await render();

    expect(panel().getAttribute('popover')).toBe('auto');
    expect(panel().getAttribute('role')).toBe('dialog');
    expect(panel().getAttribute('aria-label')).toBe('Settings');
    expect(el('#trigger').getAttribute('aria-expanded')).toBe('false');
    expect(el('#trigger').getAttribute('aria-controls')).toBe(panel().id);
  });

  it('opens from the trigger and moves focus to the first focusable element inside', async () => {
    const { fixture, el } = await render();

    el('#trigger').click();
    await fixture.whenStable();

    expect(api.showPopover).toHaveBeenCalledTimes(1);
    expect(el('#trigger').getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(el('#inside'));
  });

  it('moves focus to the entry marked data-autofocus (a menu\'s current entry) instead of the first one', async () => {
    const fixture = TestBed.createComponent(AutofocusHost);
    document.body.appendChild(fixture.nativeElement as HTMLElement);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLElement>('#trigger')?.click();
    await fixture.whenStable();

    expect(api.showPopover).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(root.querySelector('#current'));
  });

  it('closes on Esc and returns focus to the trigger', async () => {
    const { fixture, el, panel } = await render();
    el('#trigger').click();
    await fixture.whenStable();

    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    el('#inside').dispatchEvent(esc);
    await fixture.whenStable();

    expect(esc.defaultPrevented).toBe(true);
    expect(api.hidePopover).toHaveBeenCalledTimes(1);
    expect(el('#trigger').getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(el('#trigger'));
    expect(panel().getAttribute('popover')).toBe('auto');
  });

  it('follows a native light dismiss and leaves focus where the user put it', async () => {
    const { fixture, el, panel } = await render();
    el('#trigger').click();
    await fixture.whenStable();

    el('#elsewhere').focus();
    panel().dispatchEvent(Object.assign(new Event('toggle'), { newState: 'closed', oldState: 'open' }));
    await fixture.whenStable();

    expect(el('#trigger').getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(el('#elsewhere'));
  });

  it('does not reopen when the press on the trigger light-dismissed it', async () => {
    const { fixture, el } = await render();
    el('#trigger').click();
    await fixture.whenStable();

    el('#trigger').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    el('#trigger').click();
    await fixture.whenStable();

    expect(api.showPopover).toHaveBeenCalledTimes(1);
    expect(el('#trigger').getAttribute('aria-expanded')).toBe('false');
  });

  it('anchors through CSS anchor positioning where supported', async () => {
    const { fixture, el, panel } = await render();

    el('#trigger').click();
    await fixture.whenStable();

    expect(panel().style.getPropertyValue('--ui-popover-top')).toBe('');
    expect(el('ui-popover').getAttribute('data-placement')).toBe('end');
  });

  it('falls back to the trigger rect without anchor positioning, aligned to the trigger end', async () => {
    vi.spyOn(CSS, 'supports').mockReturnValue(false);
    const { fixture, el, panel } = await render();
    vi.spyOn(el('#trigger'), 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 600, y: 20, width: 40, height: 40 }));
    vi.spyOn(panel(), 'offsetWidth', 'get').mockReturnValue(320);
    vi.spyOn(panel(), 'offsetHeight', 'get').mockReturnValue(200);

    el('#trigger').click();
    await fixture.whenStable();

    // Below the trigger with an 8 px gap; the panel's end edge on the trigger's end edge (640 - 320).
    expect(panel().style.getPropertyValue('--ui-popover-top')).toBe('68px');
    expect(panel().style.getPropertyValue('--ui-popover-left')).toBe('320px');
  });
});
