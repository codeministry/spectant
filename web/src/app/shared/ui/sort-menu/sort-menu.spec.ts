import { ChangeDetectionStrategy, Component, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import type { SheetTier } from '../overlay/sheet';
import { type SortOption, UiSortMenu } from './sort-menu';

// jsdom has no Popover API and no `showModal()`: both overlays are stubbed as in popover.spec.ts and sheet.spec.ts,
// and the tier is the input the shell feeds (sheet.spec.ts). Placement and the 44 px hit area are layout, measured by
// the browser tier, not here.

const OPTIONS: readonly SortOption[] = [
  { key: 'name', label: 'Name' },
  { key: 'status', label: 'Status' },
  { key: 'added', label: 'Added' },
];

@Component({
  imports: [UiSortMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ui-sort-menu [options]="options()" [value]="value()" [label]="label()" [tier]="tier()" (choose)="chosen.push($event)" />`,
})
class Host {
  readonly options = signal<readonly SortOption[]>(OPTIONS);
  readonly value = signal('name');
  readonly label = signal('Sort');
  readonly tier = signal<SheetTier>('wide');
  readonly chosen: string[] = [];
}

const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
const dialogProto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;

function stubOverlays() {
  const showPopover = vi.fn();
  const hidePopover = vi.fn(function (this: HTMLElement) {
    this.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'closed', oldState: 'open' }));
  });
  const showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  const close = vi.fn(function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  });
  proto['showPopover'] = showPopover;
  proto['hidePopover'] = hidePopover;
  dialogProto['showModal'] = showModal;
  dialogProto['close'] = close;
  return { showPopover, hidePopover, showModal, close };
}

interface Inputs {
  value: string;
  tier: SheetTier;
}

async function render(set: Partial<Inputs> = {}) {
  const fixture = TestBed.createComponent(Host);
  const host = fixture.componentInstance;
  for (const [key, value] of Object.entries(set)) (host[key as keyof Inputs] as WritableSignal<unknown>).set(value);
  document.body.appendChild(fixture.nativeElement as HTMLElement);
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const menu = root.querySelector<HTMLElement>('ui-sort-menu') ?? (() => { throw new Error('menu missing'); })();
  const trigger = (): HTMLButtonElement => menu.querySelector<HTMLButtonElement>('button[data-control="sort"]') ?? (() => { throw new Error('trigger missing'); })();
  const items = (): HTMLButtonElement[] => [...menu.querySelectorAll<HTMLButtonElement>('[data-sort]')];
  return { fixture, host, menu, trigger, items };
}

describe('UiSortMenu', () => {
  let api: ReturnType<typeof stubOverlays>;

  beforeEach(() => {
    api = stubOverlays();
    vi.spyOn(CSS, 'supports').mockReturnValue(true);
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
    vi.restoreAllMocks();
    delete proto['showPopover'];
    delete proto['hidePopover'];
    delete dialogProto['showModal'];
    delete dialogProto['close'];
    document.body.replaceChildren();
  });

  it('a ghost trigger with arrow-up-down and the current key, named "<label>: <current>"', async () => {
    const { trigger } = await render({ value: 'status' });
    expect(trigger().classList).toContain('btn-ghost');
    expect(trigger().getAttribute('type')).toBe('button');
    expect(trigger().querySelector('ui-icon[data-icon="arrow-up-down"]')).not.toBeNull();
    expect(trigger().textContent.trim()).toBe('Status');
    expect(trigger().getAttribute('aria-label')).toBe('Sort: Status');
  });

  it('renders every key in order inside one named group, the current one pressed and autofocused', async () => {
    const { menu, items } = await render({ value: 'status' });
    expect(menu.querySelector('select')).toBeNull();
    expect(menu.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Sort');
    expect(items().map((item) => item.dataset['sort'])).toEqual(['name', 'status', 'added']);
    expect(items().map((item) => item.textContent.trim())).toEqual(['Name', 'Status', 'Added']);
    expect(items().map((item) => item.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect(items().map((item) => item.hasAttribute('data-autofocus'))).toEqual([false, true, false]);
  });

  it('follows a new value: the pressed item and the trigger move with it', async () => {
    const { fixture, host, trigger, items } = await render();
    host.value.set('added');
    await fixture.whenStable();
    expect(items().map((item) => item.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
    expect(trigger().textContent.trim()).toBe('Added');
  });

  it('from medium: a popover anchored to the trigger; a pick emits the key and closes it', async () => {
    const { fixture, host, menu, trigger, items } = await render({ tier: 'medium' });
    expect(menu.querySelector('ui-sheet')).toBeNull();
    expect(menu.querySelectorAll('ui-popover [data-sort]')).toHaveLength(3);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().getAttribute('aria-controls')).toBeTruthy();

    trigger().click();
    await fixture.whenStable();
    expect(api.showPopover).toHaveBeenCalled();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');

    items()[2]?.click();
    await fixture.whenStable();
    expect(host.chosen).toEqual(['added']);
    expect(api.hidePopover).toHaveBeenCalled();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('at compact: a bottom sheet the trigger opens as a dialog; a pick emits the key and closes it', async () => {
    const { fixture, host, menu, trigger, items } = await render({ tier: 'compact' });
    expect(menu.querySelector('ui-popover')).toBeNull();
    expect(trigger().getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');

    trigger().click();
    await fixture.whenStable();
    expect(api.showModal).toHaveBeenCalled();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(menu.querySelectorAll('ui-sheet [data-sort]')).toHaveLength(3);

    items()[1]?.click();
    await fixture.whenStable();
    expect(host.chosen).toEqual(['status']);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('a pick of the current key still closes the menu and leaves the decision to the consumer', async () => {
    const { fixture, host, trigger, items } = await render();
    trigger().click();
    await fixture.whenStable();
    items()[0]?.click();
    await fixture.whenStable();
    expect(host.chosen).toEqual(['name']);
    expect(api.hidePopover).toHaveBeenCalled();
  });
});
