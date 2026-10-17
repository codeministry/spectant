import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { Priority } from '../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { ShellState } from '../../layout/shell/shell-state.service';
import type { Tier } from '../../layout/shell/tier';
import { PriorityMenu } from './priority-menu';

// T29 · ISC-196 (design 037 § Prioritäts-Chip und Menü): the feature's priority chip is a button around `ui-priority`
// with a caret; it opens four native entries P1…P4 with the level's short word, the current one checked and
// `aria-current`, no `role="menu"`. ↑/↓ move, Enter picks, Esc closes, focus returns to the chip. Picking another
// level emits `chosen`; picking the current one emits nothing. While a write runs the chip is `aria-busy` and the menu
// stays closed. A popover at medium and wide, a bottom sheet at compact. Overlays are stubbed as in move-to-menu.spec.ts.

@Component({
  imports: [PriorityMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-priority-menu feature="F8" featureTitle="Planning model" [priority]="priority()" [busy]="busy()" (chosen)="chosen.push($event)" />`,
})
class Host {
  readonly priority = signal<Priority>('P3');
  readonly busy = signal(false);
  readonly chosen: Priority[] = [];
}

let fixture: ComponentFixture<Host>;

function stubOverlays(): void {
  const el = HTMLElement.prototype as unknown as Record<string, unknown>;
  el['showPopover'] = vi.fn(function (this: HTMLElement) {
    this.setAttribute('data-shown', '');
  });
  el['hidePopover'] = vi.fn(function (this: HTMLElement) {
    this.removeAttribute('data-shown');
    this.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'closed', oldState: 'open' }));
  });
  const dialog = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  dialog['showModal'] = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  dialog['close'] = vi.fn(function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await fixture.whenStable();
    fixture.detectChanges();
  }
}

async function mount(tier: Tier = 'wide', setup: (host: Host) => void = () => undefined): Promise<HTMLElement> {
  stubOverlays();
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' }, preloadLangs: true }),
    ],
  });
  TestBed.inject(ShellState).tier.set(tier);
  fixture = TestBed.createComponent(Host);
  setup(fixture.componentInstance);
  document.body.appendChild(fixture.nativeElement as HTMLElement);
  await settle();
  return fixture.nativeElement as HTMLElement;
}

afterEach(() => {
  (fixture.nativeElement as HTMLElement).remove();
});

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const chip = (root: HTMLElement): HTMLButtonElement => root.querySelector<HTMLButtonElement>('[data-priority-chip]') as HTMLButtonElement;
const entry = (root: HTMLElement, level: Priority): HTMLButtonElement | null =>
  root.querySelector<HTMLButtonElement>(`[data-priority-menu] [data-level-entry="${level}"]`);
const key = (target: Element | null, k: string): void => {
  target?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
};
async function openMenu(root: HTMLElement): Promise<void> {
  chip(root).click();
  await settle();
}

describe('priority-menu: the priority chip and menu (T29, ISC-196)', () => {
  it('the chip is a button around ui-priority with a caret, named after level and feature', async () => {
    const root = await mount();
    const button = chip(root);
    expect(button.tagName).toBe('BUTTON');
    expect(button.querySelector('ui-priority')?.getAttribute('data-level')).toBe('P3');
    expect(button.querySelector('ui-icon.caret')).not.toBeNull();
    expect(button.getAttribute('aria-label')).toBe('Change priority P3 of F8');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-busy')).toBeNull();
  });

  it('opens four entries P1…P4 with their short word, the current one checked and aria-current, no role=menu', async () => {
    const root = await mount();
    await openMenu(root);
    const levels = [...root.querySelectorAll<HTMLElement>('[data-priority-menu] [data-level-entry]')].map((e) => e.dataset['levelEntry']);
    expect(levels).toEqual(['P1', 'P2', 'P3', 'P4']);
    expect(root.querySelector('[role="menu"]')).toBeNull();
    expect(chip(root).getAttribute('aria-expanded')).toBe('true');
    expect(text(entry(root, 'P1')?.querySelector('.word'))).toBe('highest');
    expect(text(entry(root, 'P4')?.querySelector('.word'))).toBe('low');
    expect(entry(root, 'P1')?.querySelector('ui-priority')?.getAttribute('data-level')).toBe('P1');
    expect(entry(root, 'P3')?.getAttribute('aria-current')).toBe('true');
    expect(entry(root, 'P3')?.querySelector('[data-check]')).not.toBeNull();
    expect(entry(root, 'P1')?.getAttribute('aria-current')).toBeNull();
    expect(entry(root, 'P1')?.querySelector('[data-check]')).toBeNull();
    // the current entry takes focus; the panel is right-aligned under the chip
    expect(document.activeElement).toBe(entry(root, 'P3'));
    expect(root.querySelector('ui-popover')?.getAttribute('data-placement')).toBe('end');
    expect(root.querySelector('[popover]')?.getAttribute('aria-label')).toBe('Priority · F8');
  });

  it('↑/↓ move between entries; picking another level emits it once, closes and focuses the chip', async () => {
    const root = await mount();
    await openMenu(root);
    key(document.activeElement, 'ArrowUp');
    expect(document.activeElement).toBe(entry(root, 'P2'));
    key(document.activeElement, 'ArrowDown');
    key(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(entry(root, 'P4'));
    entry(root, 'P2')?.click();
    await settle();
    expect(fixture.componentInstance.chosen).toEqual(['P2']);
    expect(root.querySelector('[popover][data-shown]')).toBeNull();
    expect(document.activeElement).toBe(chip(root));
  });

  it('picking the current level emits nothing and closes', async () => {
    const root = await mount();
    await openMenu(root);
    entry(root, 'P3')?.click();
    await settle();
    expect(fixture.componentInstance.chosen).toEqual([]);
    expect(root.querySelector('[popover][data-shown]')).toBeNull();
    expect(document.activeElement).toBe(chip(root));
  });

  it('Esc closes and returns focus to the chip', async () => {
    const root = await mount();
    await openMenu(root);
    key(document.activeElement, 'Escape');
    await settle();
    expect(root.querySelector('[popover][data-shown]')).toBeNull();
    expect(document.activeElement).toBe(chip(root));
    expect(fixture.componentInstance.chosen).toEqual([]);
  });

  it('while busy the chip is aria-busy and the menu stays closed; a new value shows on the chip', async () => {
    const root = await mount('wide', (h) => {
      h.busy.set(true);
    });
    expect(chip(root).getAttribute('aria-busy')).toBe('true');
    await openMenu(root);
    expect(root.querySelector('[popover][data-shown]')).toBeNull();
    expect(root.querySelector('[data-priority-menu]')).toBeNull();
    fixture.componentInstance.busy.set(false);
    fixture.componentInstance.priority.set('P1');
    await settle();
    expect(chip(root).getAttribute('aria-busy')).toBeNull();
    expect(chip(root).querySelector('ui-priority')?.getAttribute('data-level')).toBe('P1');
    expect(chip(root).getAttribute('aria-label')).toBe('Change priority P1 of F8');
  });

  it('is a modal bottom sheet at compact, titled with the feature and its title, focus back to the chip', async () => {
    const root = await mount('compact');
    await openMenu(root);
    const dialog = root.querySelector('[data-priority-menu]')?.closest('dialog');
    expect(dialog?.hasAttribute('open')).toBe(true);
    expect(root.querySelector('[data-priority-menu]')?.getAttribute('data-surface')).toBe('sheet');
    expect(text(dialog?.querySelector('h2'))).toBe('Priority · F8');
    expect(text(dialog?.querySelector('[data-feature-title]'))).toBe('Planning model');
    entry(root, 'P1')?.click();
    await settle();
    expect(fixture.componentInstance.chosen).toEqual(['P1']);
    expect(dialog?.hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(chip(root));
  });
});
