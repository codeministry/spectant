import { TestBed } from '@angular/core/testing';
import { UiCommandChip } from './command-chip';

describe('UiCommandChip', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('copies through the Clipboard API, emits the command and swaps to the check', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const fixture = TestBed.createComponent(UiCommandChip);
    fixture.componentRef.setInput('command', '/spec-implement 012');
    const emitted: string[] = [];
    fixture.componentInstance.copied.subscribe((c) => emitted.push(c));
    await fixture.whenStable();

    const button = (fixture.nativeElement as HTMLElement).querySelector('button');
    button?.click();
    await fixture.whenStable();
    expect(writeText).toHaveBeenCalledWith('/spec-implement 012');
    expect(emitted).toEqual(['/spec-implement 012']);
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
    Reflect.deleteProperty(document, 'execCommand');
  });
});
