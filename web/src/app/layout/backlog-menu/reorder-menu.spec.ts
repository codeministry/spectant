import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { ShellState } from '../shell/shell-state.service';
import type { Tier } from '../shell/tier';
import { isApplePlatform, ReorderMenu, type ReorderStep, stepCap } from './reorder-menu';

// T22 · ISC-195 (design 037 § Griff, § Viewport-übergreifend): "Move" without a drag (WCAG 2.5.7). A plain click on
// the grip opens four entries, up, down, to the top and to the end of the group, the first two with their Alt+↑/↓
// key caps; entries at the group's edge are aria-disabled but focusable and name their reason. An entry emits `step`,
// closes the menu and focus goes back to the grip. A popover at medium and wide, a bottom sheet at compact. jsdom has
// neither the Popover API nor `showModal()`: both are stubbed as the browser behaves (move-to-menu.spec.ts).

@Component({
  imports: [ReorderMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button #grip type="button" data-grip (click)="menu.show(grip)">grip</button>
    <app-reorder-menu
      #menu
      feature="F8"
      [group]="group()"
      [canUp]="canUp()"
      [canDown]="canDown()"
      [position]="position()"
      [count]="count()"
      (step)="steps.push($event)"
    />
  `,
})
class Host {
  readonly group = signal<string | null>('Free');
  readonly canUp = signal(true);
  readonly canDown = signal(true);
  readonly position = signal<number | null>(8);
  readonly count = signal<number | null>(9);
  readonly steps: ReorderStep[] = [];
}

let fixture: ComponentFixture<Host> | undefined;

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
    await host().whenStable();
    host().detectChanges();
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
  (fixture?.nativeElement as HTMLElement | undefined)?.remove();
  fixture = undefined;
});

/** The mounted host; every test but the pure key-cap one mounts first. */
const host = (): ComponentFixture<Host> => {
  if (!fixture) throw new Error('not mounted');
  return fixture;
};

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const grip = (root: HTMLElement): HTMLButtonElement => root.querySelector<HTMLButtonElement>('[data-grip]') as HTMLButtonElement;
const entry = (root: HTMLElement, step: ReorderStep): HTMLButtonElement | null =>
  root.querySelector<HTMLButtonElement>(`[data-reorder-menu] [data-step="${step}"]`);
async function openMenu(root: HTMLElement): Promise<void> {
  grip(root).click();
  await settle();
}

describe('reorder-menu: key caps (T22)', () => {
  it('reads Apple platforms from the user agent and writes ⌥↑/⌥↓ there, Alt+↑/Alt+↓ elsewhere', () => {
    expect(isApplePlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)')).toBe(true);
    expect(isApplePlatform('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)')).toBe(true);
    expect(isApplePlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe(false);
    expect(stepCap(true, 'up')).toBe('⌥↑');
    expect(stepCap(true, 'down')).toBe('⌥↓');
    expect(stepCap(false, 'up')).toBe('Alt+↑');
    expect(stepCap(false, 'down')).toBe('Alt+↓');
  });
});

describe('reorder-menu: the Move menu (T22, ISC-195)', () => {
  it('a plain click on the grip opens up, down, to the top and to the end of the group, with Alt+↑/↓ caps', async () => {
    const root = await mount();
    await openMenu(root);
    const steps = [...root.querySelectorAll<HTMLElement>('[data-reorder-menu] [data-step]')].map((e) => e.dataset['step']);
    expect(steps).toEqual(['up', 'down', 'first', 'last']);
    expect(root.querySelector('[data-reorder-menu]')?.getAttribute('role')).toBe('list');
    expect(root.querySelector('[role="menu"]')).toBeNull();
    expect(text(entry(root, 'up')?.querySelector('.name'))).toBe('Move up');
    expect(text(entry(root, 'down')?.querySelector('.name'))).toBe('Move down');
    expect(text(entry(root, 'first'))).toBe('Move to the top');
    expect(text(entry(root, 'last'))).toBe('Move to the end of Free');
    expect(text(entry(root, 'up')?.querySelector('ui-kbd'))).toBe('Alt+↑');
    expect(text(entry(root, 'down')?.querySelector('ui-kbd'))).toBe('Alt+↓');
    expect(entry(root, 'up')?.getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowUp');
    expect(entry(root, 'down')?.getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowDown');
    expect(entry(root, 'first')?.querySelector('ui-kbd')).toBeNull();
    expect(document.activeElement).toBe(entry(root, 'up'));
    // the panel is named after the feature and its group, the position line below
    expect(root.querySelector('[popover]')?.getAttribute('aria-label')).toBe('Move F8 · in Free');
    expect(text(root.querySelector('[data-reorder-position]'))).toBe('Position 8 of 9');
  });

  it('at the top edge up and to the top are aria-disabled, focusable, give their reason and emit nothing', async () => {
    const root = await mount('wide', (h) => {
      h.canUp.set(false);
    });
    await openMenu(root);
    for (const step of ['up', 'first'] as const) {
      const e = entry(root, step);
      expect(e?.getAttribute('aria-disabled')).toBe('true');
      expect(e?.hasAttribute('disabled')).toBe(false);
      expect(text(e?.querySelector('.hint'))).toBe('already first');
      e?.click();
    }
    expect(entry(root, 'up')?.querySelector('ui-kbd')).toBeNull();
    expect(entry(root, 'down')?.getAttribute('aria-disabled')).toBeNull();
    // the first enabled entry takes focus
    expect(document.activeElement).toBe(entry(root, 'down'));
    await settle();
    expect(host().componentInstance.steps).toEqual([]);
    expect(root.querySelector('[popover][data-shown]')).not.toBeNull();
  });

  it('at the bottom edge down and to the end are aria-disabled with their reason', async () => {
    const root = await mount('wide', (h) => {
      h.canDown.set(false);
    });
    await openMenu(root);
    expect(entry(root, 'down')?.getAttribute('aria-disabled')).toBe('true');
    expect(entry(root, 'last')?.getAttribute('aria-disabled')).toBe('true');
    expect(text(entry(root, 'last')?.querySelector('.hint'))).toBe('already last');
    expect(entry(root, 'first')?.getAttribute('aria-disabled')).toBeNull();
  });

  it('without a milestone the last entry reads "to the end" and the panel names no milestone', async () => {
    const root = await mount('wide', (h) => {
      h.group.set(null);
    });
    await openMenu(root);
    expect(text(entry(root, 'last'))).toBe('Move to the end');
    expect(root.querySelector('[popover]')?.getAttribute('aria-label')).toBe('Move F8 · no milestone');
  });

  it('an enabled entry emits its step once, closes the menu and returns focus to the grip', async () => {
    const root = await mount();
    await openMenu(root);
    entry(root, 'last')?.click();
    await settle();
    expect(host().componentInstance.steps).toEqual(['last']);
    expect(root.querySelector('[popover][data-shown]')).toBeNull();
    expect(document.activeElement).toBe(grip(root));
  });

  it('↓ moves focus to the next entry; Esc closes and returns focus to the grip', async () => {
    const root = await mount();
    await openMenu(root);
    entry(root, 'up')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(entry(root, 'down'));
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(root.querySelector('[popover][data-shown]')).toBeNull();
    expect(document.activeElement).toBe(grip(root));
    expect(host().componentInstance.steps).toEqual([]);
  });

  it('is a popover at medium and a modal bottom sheet with the position line at compact', async () => {
    let root = await mount('medium');
    await openMenu(root);
    expect(root.querySelector('[data-reorder-menu]')?.closest('[popover]')).not.toBeNull();
    expect(root.querySelector('[data-reorder-menu]')?.getAttribute('data-surface')).toBe('popover');
    root.remove();
    TestBed.resetTestingModule();

    root = await mount('compact');
    await openMenu(root);
    const dialog = root.querySelector('[data-reorder-menu]')?.closest('dialog');
    expect(dialog?.hasAttribute('open')).toBe(true);
    expect(root.querySelector('[data-reorder-menu]')?.getAttribute('data-surface')).toBe('sheet');
    expect(text(dialog?.querySelector('h2'))).toBe('Move F8 · in Free');
    expect(text(dialog?.querySelector('[data-reorder-position]'))).toBe('Position 8 of 9');
    entry(root, 'down')?.click();
    await settle();
    expect(host().componentInstance.steps).toEqual(['down']);
    expect(dialog?.hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(grip(root));
  });
});
