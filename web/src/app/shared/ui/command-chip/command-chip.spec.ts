import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { ToastService } from '../toast/toast';
import { UiCommandChip } from './command-chip';

describe('UiCommandChip', () => {
  beforeEach(() => {
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
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('copies through the Clipboard API, emits the command and swaps to the check', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const fixture = TestBed.createComponent(UiCommandChip);
    fixture.componentRef.setInput('command', '/spec implement 012');
    const emitted: string[] = [];
    fixture.componentInstance.copied.subscribe((c) => emitted.push(c));
    await fixture.whenStable();

    const button = (fixture.nativeElement as HTMLElement).querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('Copy /spec implement 012');
    button?.click();
    await fixture.whenStable();
    expect(writeText).toHaveBeenCalledWith('/spec implement 012');
    expect(emitted).toEqual(['/spec implement 012']);
    expect(button?.getAttribute('aria-label')).toBe('Copied');
  });

  it('selects the command and shows the manual hint when every copy path fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denied')) },
      configurable: true,
    });
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });
    const fixture = TestBed.createComponent(UiCommandChip);
    fixture.componentRef.setInput('command', 'spectant add <path-to-repo>');
    await fixture.whenStable();

    (fixture.nativeElement as HTMLElement).querySelector('button')?.click();
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('.hint')?.textContent).toBe('Select and press ⌘C');
    expect(TestBed.inject(ToastService).message(), 'the inline default raises no toast').toBeNull();
    Reflect.deleteProperty(document, 'execCommand');
  });

  // Spec 064, T12 · ISC-478: inside a fixed-height tile (`hint="toast"`) the manual hint goes to the app toast instead
  // of wrapping under the chip; the inline default stays as it was.
  it('raises the manual hint as the app toast, with no inline hint, when hint is "toast"', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denied')) },
      configurable: true,
    });
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });
    const fixture = TestBed.createComponent(UiCommandChip);
    fixture.componentRef.setInput('command', '/spec implement 064');
    fixture.componentRef.setInput('hint', 'toast');
    await fixture.whenStable();

    (fixture.nativeElement as HTMLElement).querySelector('button')?.click();
    await fixture.whenStable();
    expect(TestBed.inject(ToastService).message()).toBe('Select and press ⌘C');
    expect((fixture.nativeElement as HTMLElement).querySelector('.hint')).toBeNull();
    TestBed.inject(ToastService).dismiss();
    Reflect.deleteProperty(document, 'execCommand');
  });

  // Spec 040, T47 · ISC-225.1: locked while a run is running — lock glyph, aria-disabled but focusable, a name that
  // names the run, actor and duration; copying is refused and a press opens the hint line instead.
  it('locks while a run holds the item: lock glyph, focusable, named by the run, copy refused, a press shows the hint', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const fixture = TestBed.createComponent(UiCommandChip);
    fixture.componentRef.setInput('command', '/spec tasks 037');
    fixture.componentRef.setInput('lockedBy', {
      run: 'run-1',
      command: '/spec tasks 037',
      session: 'a:claude:sess-7',
      actor: { raw: 'a:claude:sess-7', kind: 'agent', id: 'a:claude:sess-7', legacy: false },
      since: '2026-10-17T14:02:00Z',
      elapsedMs: 3 * 60_000,
      openRuns: 1,
      source: 'run',
    });
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const button = root.querySelector('button');
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    expect(button?.disabled).toBe(false);
    expect(button?.querySelector('ui-icon')?.getAttribute('data-icon')).toBe('lock');
    expect(button?.getAttribute('aria-label')).toBe('Locked · /spec tasks 037 is running · a:claude:sess-7 · since 3 min');
    expect(root.querySelector('[data-locked-hint]')).toBeNull();
    expect(root.querySelector('ui-live-region'), 'a locked chip carries no live region').toBeNull();
    button?.click();
    await fixture.whenStable();
    expect(writeText).not.toHaveBeenCalled();
    expect(root.querySelector('[data-locked-hint]')?.textContent).toBe('Running for 3 min · copyable once it ends');
    fixture.componentRef.setInput('lockedBy', null);
    await fixture.whenStable();
    expect(root.querySelector('button ui-icon')?.getAttribute('data-icon')).toBe('copy');
    expect(root.querySelector('[data-locked-hint]')).toBeNull();
    expect(root.querySelector('ui-live-region')?.textContent).toBe('');
  });

  // Spec 020, T28 · ISC-241: the clipboard gets exactly the command, without whitespace before or after, and the
  // chip's own polite live region announces it ("Copied /spec implement 012"); a repeat is announced again.
  it('copies the trimmed command and announces it in its live region', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const fixture = TestBed.createComponent(UiCommandChip);
    fixture.componentRef.setInput('command', '  /spec implement 012\n');
    const emitted: string[] = [];
    fixture.componentInstance.copied.subscribe((c) => emitted.push(c));
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const region = root.querySelector('ui-live-region');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.textContent).toBe('');

    root.querySelector('button')?.click();
    await fixture.whenStable();
    expect(writeText).toHaveBeenCalledWith('/spec implement 012');
    expect(emitted).toEqual(['/spec implement 012']);
    expect(region?.textContent).toBe('Copied /spec implement 012');

    root.querySelector('button')?.click();
    await fixture.whenStable();
    expect(region?.textContent).toBe(`Copied /spec implement 012${String.fromCharCode(0xa0)}`);
  });
});
