import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { type RovingActive, UiRovingCompanion, UiRovingItem, UiRovingList } from './roving-list.directive';

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

  it('leaves → and ← alone when the list has no companions, as before spec 052', async () => {
    const right = await press('ArrowRight');
    const left = await press('ArrowLeft');
    expect(right.defaultPrevented).toBe(false);
    expect(left.defaultPrevented).toBe(false);
    expect(active()).toBe('a');
  });
});

/** Spec 052 T15: each row is a link (the roving item) and a star beside it (its companion), as in the spec select. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiRovingList, UiRovingItem, UiRovingCompanion],
  template: `
    <ul uiRovingList (activeChange)="changes.push($event)">
      @for (item of items(); track item) {
        <li>
          <a uiRovingItem #link="uiRovingItem" href="#{{ item }}">{{ item }}</a>
          <button type="button" class="star" [uiRovingCompanion]="link">{{ item }}</button>
        </li>
      }
    </ul>
  `,
})
class CompanionHost {
  readonly items = signal(['a', 'b', 'c', 'd']);
  readonly changes: RovingActive[] = [];
}

describe('UiRovingCompanion', () => {
  let fixture: ComponentFixture<CompanionHost>;
  let host: HTMLElement;

  const links = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[uiRovingItem]')];
  const stars = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('.star')];
  const star = (name: string): HTMLElement => {
    const found = stars().find((s) => s.textContent.trim() === name);
    if (!found) throw new Error(`no star ${name}`);
    return found;
  };
  /** Every element holding a tab stop, as `TAG:row`. */
  const tabStops = (): string[] =>
    [...links(), ...stars()].filter((e) => e.tabIndex === 0).map((e) => `${e.tagName}:${e.textContent.trim()}`);

  async function press(key: string, target: HTMLElement): Promise<KeyboardEvent> {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    await fixture.whenStable();
    return event;
  }

  beforeEach(async () => {
    fixture = TestBed.createComponent(CompanionHost);
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('mirrors its row item: one tab stop per active row, on the link and its star', async () => {
    expect(stars().map((s) => s.tabIndex)).toEqual([0, -1, -1, -1]);
    expect(tabStops()).toEqual(['A:a', 'BUTTON:a']);
    await press('ArrowDown', links()[0]);
    expect(stars().map((s) => s.tabIndex)).toEqual([-1, 0, -1, -1]);
    expect(tabStops()).toEqual(['A:b', 'BUTTON:b']);
  });

  it('moves → from the item to its companion and ← back, without changing the active row', async () => {
    await press('ArrowDown', links()[0]); // b
    const right = await press('ArrowRight', links()[1]);
    expect(right.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(star('b'));
    const left = await press('ArrowLeft', star('b'));
    expect(left.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(links()[1]);
    expect(fixture.componentInstance.changes.map((c) => c.index)).toEqual([1]);
  });

  it('leaves → on a companion and ← on an item alone', async () => {
    const right = await press('ArrowRight', star('a'));
    const left = await press('ArrowLeft', links()[0]);
    expect(right.defaultPrevented).toBe(false);
    expect(left.defaultPrevented).toBe(false);
  });

  it('makes a focused companion its row the active one, and ↓ from it moves to the next item', async () => {
    star('c').focus();
    await fixture.whenStable();
    expect(tabStops()).toEqual(['A:c', 'BUTTON:c']);
    expect(fixture.componentInstance.changes.at(-1)).toEqual({ index: 2, element: links()[2] });

    await press('ArrowDown', star('c'));
    expect(document.activeElement).toBe(links()[3]);
    expect(tabStops()).toEqual(['A:d', 'BUTTON:d']);
  });

  it('keeps the position when the row of the focused companion goes away, clamped to the new end', async () => {
    star('b').focus();
    await fixture.whenStable();
    fixture.componentInstance.items.set(['a', 'c', 'd']);
    await fixture.whenStable();
    expect(tabStops()).toEqual(['A:c', 'BUTTON:c']);

    star('d').focus();
    await fixture.whenStable();
    fixture.componentInstance.items.set(['a', 'c']);
    await fixture.whenStable();
    expect(tabStops()).toEqual(['A:c', 'BUTTON:c']);

    fixture.componentInstance.items.set([]);
    await fixture.whenStable();
    expect(tabStops()).toEqual([]);
  });
});
