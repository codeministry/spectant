import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiTerm } from './term';

// jsdom has no Popover API, no layout and no hover: `showPopover` / `hidePopover` are stubbed on the prototype (each
// fires the `toggle` event a browser queues), pointers are synthetic events. The top layer, the anchored geometry and
// real hover, focus-visible and tap are measured by the browser tier and the e2e probe (T42).

@Component({
  imports: [UiTerm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1><ui-term hint="Epic in a ticket tracker" id="features-term">Features</ui-term> in harbor</h1>
    <button id="elsewhere" type="button">Elsewhere</button>
  `,
})
class Host {}

interface Stubbed {
  showPopover: ReturnType<typeof vi.fn>;
  hidePopover: ReturnType<typeof vi.fn>;
}

const proto = HTMLElement.prototype as unknown as Record<string, unknown>;

function stubPopoverApi(): Stubbed {
  const toggle = (el: HTMLElement, newState: 'open' | 'closed') =>
    el.dispatchEvent(Object.assign(new Event('toggle'), { newState, oldState: newState === 'open' ? 'closed' : 'open' }));
  const showPopover = vi.fn(function (this: HTMLElement) {
    toggle(this, 'open');
  });
  const hidePopover = vi.fn(function (this: HTMLElement) {
    toggle(this, 'closed');
  });
  proto['showPopover'] = showPopover;
  proto['hidePopover'] = hidePopover;
  return { showPopover, hidePopover };
}

/** A pointer event jsdom can dispatch (it has no `PointerEvent` constructor with `pointerType`). */
const pointer = (type: string, pointerType: 'mouse' | 'touch' | 'pen'): Event =>
  Object.assign(new MouseEvent(type, { bubbles: type !== 'pointerenter' && type !== 'pointerleave' }), { pointerType });

/** Focus as Tab gives it: jsdom, like a browser, decides `:focus-visible` from the key pressed on the element before. */
function keyboardFocus(el: HTMLElement): void {
  (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  el.focus();
}

async function render() {
  const fixture = TestBed.createComponent(Host);
  document.body.appendChild(fixture.nativeElement as HTMLElement);
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const el = (selector: string): HTMLElement =>
    root.querySelector<HTMLElement>(selector) ?? (() => { throw new Error(`${selector} missing`); })();
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
  };
  return { fixture, el, settle, term: () => el('dfn'), hint: () => el('[popover]'), host: () => el('ui-term') };
}

describe('UiTerm', () => {
  let api: Stubbed;

  beforeEach(() => {
    api = stubPopoverApi();
    vi.spyOn(CSS, 'supports').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete proto['showPopover'];
    delete proto['hidePopover'];
    document.body.innerHTML = '';
  });

  it('renders the projected word in a focusable <dfn>, the visible vocabulary unchanged', async () => {
    const { term, host } = await render();

    expect(term().tagName).toBe('DFN');
    expect(term().textContent.trim()).toBe('Features');
    expect(term().getAttribute('tabindex')).toBe('0');
    expect(term().id).toBe('features-term');
    // The id lives on the term only, never twice in the document.
    expect(host().hasAttribute('id')).toBe(false);
  });

  it('points aria-describedby at the hint, so assistive tech reads it without opening', async () => {
    const { term, hint } = await render();

    const describedBy = term().getAttribute('aria-describedby') ?? '';
    const target = document.getElementById(describedBy);

    expect(describedBy).toBe('features-term-hint');
    expect(target).toBe(hint());
    expect(target?.textContent.trim()).toBe('Epic in a ticket tracker');
    expect(target?.getAttribute('role')).toBe('tooltip');
    expect(term().hasAttribute('title')).toBe(false);
  });

  it('falls back to a manual popover where popover="hint" is unsupported (jsdom, WebKit < 26)', async () => {
    const { hint } = await render();

    expect(hint().getAttribute('popover')).toBe('manual');
  });

  it('uses popover="hint" where the platform knows it', async () => {
    Object.defineProperty(HTMLElement.prototype, 'popover', {
      configurable: true,
      get(this: HTMLElement) {
        return this.getAttribute('popover');
      },
    });
    try {
      const { hint } = await render();
      expect(hint().getAttribute('popover')).toBe('hint');
    } finally {
      delete proto['popover'];
    }
  });

  it('opens on keyboard focus and closes on Escape, focus staying on the term', async () => {
    const { term, host, settle } = await render();

    keyboardFocus(term());
    await settle();

    expect(api.showPopover).toHaveBeenCalledTimes(1);
    expect(host().getAttribute('data-open')).toBe('true');

    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    term().dispatchEvent(esc);
    await settle();

    expect(api.hidePopover).toHaveBeenCalledTimes(1);
    expect(host().hasAttribute('data-open')).toBe(false);
    expect(document.activeElement).toBe(term());
    expect(esc.defaultPrevented).toBe(true);
  });

  it('lets Escape through when the hint is already closed', async () => {
    const { term, settle } = await render();
    keyboardFocus(term());
    await settle();
    term().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();

    const second = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    term().dispatchEvent(second);

    expect(second.defaultPrevented).toBe(false);
  });

  it('closes on blur', async () => {
    const { term, el, host, settle } = await render();
    keyboardFocus(term());
    await settle();

    el('#elsewhere').focus();
    await settle();

    expect(host().hasAttribute('data-open')).toBe(false);
    expect(api.hidePopover).toHaveBeenCalledTimes(1);
  });

  it('toggles on tap: coarse pointers get no hover', async () => {
    const { term, host, settle } = await render();

    // A tap: the touch pointer enters (no hover open), presses, focuses the term (not focus-visible), then clicks.
    host().dispatchEvent(pointer('pointerenter', 'touch'));
    term().dispatchEvent(pointer('pointerdown', 'touch'));
    term().focus();
    await settle();
    expect(api.showPopover).not.toHaveBeenCalled();

    term().dispatchEvent(pointer('click', 'touch'));
    await settle();
    expect(host().getAttribute('data-open')).toBe('true');

    term().dispatchEvent(pointer('pointerdown', 'touch'));
    term().dispatchEvent(pointer('click', 'touch'));
    await settle();
    expect(host().hasAttribute('data-open')).toBe(false);
    expect(api.showPopover).toHaveBeenCalledTimes(1);
    expect(api.hidePopover).toHaveBeenCalledTimes(1);
  });

  it('opens on mouse hover after the tooltip delay and closes when the pointer leaves', async () => {
    const { host, settle } = await render();

    host().dispatchEvent(pointer('pointerenter', 'mouse'));
    await settle();
    expect(host().getAttribute('data-open')).toBe('true');

    host().dispatchEvent(pointer('pointerleave', 'mouse'));
    await settle();
    expect(host().hasAttribute('data-open')).toBe(false);
  });

  it('never opens when the pointer leaves before the delay runs out', async () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (name: string) => (name === '--motion-duration-base' ? '240ms' : ''),
    } as CSSStyleDeclaration);
    const { host, settle } = await render();

    host().dispatchEvent(pointer('pointerenter', 'mouse'));
    await new Promise((resolve) => setTimeout(resolve, 100));
    host().dispatchEvent(pointer('pointerleave', 'mouse'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    await settle();

    expect(api.showPopover).not.toHaveBeenCalled();
  });

  it('keeps a keyboard-opened hint when a mouse passes over and leaves', async () => {
    const { term, host, settle } = await render();
    keyboardFocus(term());
    await settle();

    host().dispatchEvent(pointer('pointerenter', 'mouse'));
    host().dispatchEvent(pointer('pointerleave', 'mouse'));
    await settle();

    expect(host().getAttribute('data-open')).toBe('true');
  });

  it('follows the platform when it hides the hint itself (light dismiss, another hint)', async () => {
    const { term, hint, host, settle } = await render();
    keyboardFocus(term());
    await settle();

    hint().dispatchEvent(Object.assign(new Event('toggle'), { newState: 'closed', oldState: 'open' }));
    await settle();

    expect(host().hasAttribute('data-open')).toBe(false);
    expect(api.hidePopover).not.toHaveBeenCalled();
  });
});
