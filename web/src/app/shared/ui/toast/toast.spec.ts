import { TestBed } from '@angular/core/testing';
import { TOAST_MS, ToastService, UiToast } from './toast';

// The entry fade runs on motion tokens (0ms under reduced motion, motion.css); timing here is the dismiss contract.

describe('UiToast', () => {
  afterEach(() => vi.useRealTimers());

  async function render() {
    const fixture = TestBed.createComponent(UiToast);
    await fixture.whenStable();
    // Faked only after the first render: fake timers would freeze the zoneless scheduler behind `whenStable()`, so
    // the tests settle with synchronous change detection (twice: the effect announces, then the region renders).
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const host = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      fixture.detectChanges();
      fixture.detectChanges();
      await Promise.resolve();
    };
    return { host, settle, toasts: TestBed.inject(ToastService) };
  }

  it('shows the text and announces it through the one polite live region', async () => {
    const { host, settle, toasts } = await render();

    toasts.show('Copied /spec-implement 012');
    await settle();

    const regions = host.querySelectorAll('[aria-live]');
    expect(regions).toHaveLength(1);
    expect(host.querySelector('ui-live-region')?.getAttribute('aria-live')).toBe('polite');
    expect(host.querySelector('ui-live-region')?.textContent).toBe('Copied /spec-implement 012');
    expect(host.querySelector('.toast')?.textContent.trim()).toBe('Copied /spec-implement 012');
  });

  it('dismisses itself after 4 s, and a new toast restarts the clock', async () => {
    const { host, settle, toasts } = await render();

    toasts.show('First');
    vi.advanceTimersByTime(TOAST_MS - 1000);
    toasts.show('Second');
    vi.advanceTimersByTime(TOAST_MS - 1);
    await settle();
    expect(host.querySelector('.toast')?.textContent.trim()).toBe('Second');

    vi.advanceTimersByTime(1);
    await settle();
    expect(TOAST_MS).toBe(4000);
    expect(toasts.message()).toBeNull();
    expect(host.querySelector('.toast')).toBeNull();
  });
});
