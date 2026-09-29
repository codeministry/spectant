import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { type RovingActive, UiRovingItem, UiRovingList } from './roving-list.directive';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiRovingList, UiRovingItem],
  template: `
    <div uiRovingList [singleKeys]="singleKeys()" (activeChange)="changes.push($event)">
      <input class="filter" />
      @for (item of items(); track item) {
        <a uiRovingItem href="#{{ item }}">{{ item }}</a>
      }
    </div>
  `,
})
class RovingHost {
  readonly items = signal(['a', 'b', 'c', 'd']);
  readonly singleKeys = signal(true);
  readonly changes: RovingActive[] = [];
}

describe('UiRovingList', () => {
  let fixture: ComponentFixture<RovingHost>;
  let host: HTMLElement;

  const rows = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[uiRovingItem]')];
  const tabIndexes = (): number[] => rows().map((r) => r.tabIndex);
  const active = (): string | undefined => rows().find((r) => r.tabIndex === 0)?.textContent.trim();

  /** Dispatches a bubbling keydown on `target` (default: the active row) and returns the event. */
  async function press(key: string, init: KeyboardEventInit = {}, target?: HTMLElement): Promise<KeyboardEvent> {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    (target ?? rows().find((r) => r.tabIndex === 0) ?? rows()[0]).dispatchEvent(event);
    await fixture.whenStable();
    return event;
  }

  beforeEach(async () => {
    fixture = TestBed.createComponent(RovingHost);
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('keeps exactly one tab stop, on the first item at start', () => {
    expect(tabIndexes()).toEqual([0, -1, -1, -1]);
  });

  it('moves with ↓ / ↑, rovers the tabindex, focuses the item and emits activeChange', async () => {
    const down = await press('ArrowDown');
    await press('ArrowDown');
    expect(down.defaultPrevented).toBe(true);
    expect(tabIndexes()).toEqual([-1, -1, 0, -1]);
    expect(document.activeElement).toBe(rows()[2]);

    await press('ArrowUp');
    expect(active()).toBe('b');
    expect(fixture.componentInstance.changes.map((c) => c.index)).toEqual([1, 2, 1]);
    expect(fixture.componentInstance.changes[2].element).toBe(rows()[1]);
  });

  it('moves with j / k like ↓ / ↑', async () => {
    await press('j');
    await press('j');
    await press('k');
    expect(active()).toBe('b');
  });

  it('does not wrap at either end and emits nothing when it cannot move', async () => {
    await press('ArrowUp');
    expect(active()).toBe('a');
    await press('End');
    await press('ArrowDown');
    await press('j');
    expect(active()).toBe('d');
    expect(fixture.componentInstance.changes.map((c) => c.index)).toEqual([3]);
  });

  it('jumps to the first and last item with Home / End', async () => {
    await press('End');
    expect(active()).toBe('d');
    expect(document.activeElement).toBe(rows()[3]);
    await press('Home');
    expect(active()).toBe('a');
  });

  it('ignores keys typed into an input inside the list', async () => {
    const input = host.querySelector<HTMLInputElement>('.filter');
    if (!input) throw new Error('no input');
    const j = await press('j', {}, input);
    const down = await press('ArrowDown', {}, input);
    expect(j.defaultPrevented).toBe(false);
    expect(down.defaultPrevented).toBe(false);
    expect(active()).toBe('a');
  });

  it('ignores keys under Ctrl, Meta or Alt but still moves under Shift', async () => {
    await press('ArrowDown', { ctrlKey: true });
    await press('ArrowDown', { metaKey: true });
    await press('ArrowDown', { altKey: true });
    expect(active()).toBe('a');
    await press('ArrowDown', { shiftKey: true });
    expect(active()).toBe('b');
  });

  it('disables j / k when singleKeys is off, arrows keep working', async () => {
    fixture.componentInstance.singleKeys.set(false);
    await fixture.whenStable();
    const j = await press('j');
    expect(j.defaultPrevented).toBe(false);
    expect(active()).toBe('a');
    await press('ArrowDown');
    expect(active()).toBe('b');
  });

  it('makes a focused item (click, Tab back in) the active one', async () => {
    rows()[2].focus();
    await fixture.whenStable();
    expect(tabIndexes()).toEqual([-1, -1, 0, -1]);
    expect(fixture.componentInstance.changes.at(-1)?.index).toBe(2);
  });

  it('follows items added or removed later, keeping the same item active', async () => {
    await press('End'); // d
    fixture.componentInstance.items.set(['x', 'a', 'b', 'c', 'd', 'e']);
    await fixture.whenStable();
    expect(active()).toBe('d');
    expect(tabIndexes().filter((t) => t === 0)).toHaveLength(1);

    await press('ArrowDown');
    expect(active()).toBe('e');

    // The active item goes away: the selection stays at its position, clamped to the new end.
    fixture.componentInstance.items.set(['x', 'a']);
    await fixture.whenStable();
    expect(active()).toBe('a');
    expect(tabIndexes()).toEqual([-1, 0]);
  });
});
