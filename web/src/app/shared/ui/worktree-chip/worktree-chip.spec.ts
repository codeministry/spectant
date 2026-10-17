import { ChangeDetectionStrategy, Component, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import type { SpecSource, Worktree } from '../../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import type { SheetTier } from '../overlay/sheet';
import { UiWorktreeChip } from './worktree-chip';

// jsdom has no Popover API, no `showModal()` and no container queries: both overlays are stubbed as in popover.spec.ts
// and sheet.spec.ts, and the tier is the input the shell feeds (sheet.spec.ts). The compact form's widening at a
// 280 px card and the 44 px hit area are layout, measured by the browser tier, not here.

const WORKTREE: Worktree = {
  path: '.worktrees/027-worktree-live-view',
  branch: 'feature/027-worktree-live-view',
  spec: '027',
  ahead: 2,
  dirty: true,
  kind: 'spec',
};

@Component({
  imports: [UiWorktreeChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-worktree-chip
      [worktree]="worktree()"
      [compact]="compact()"
      [interactive]="interactive()"
      [mismatch]="mismatch()"
      [source]="source()"
      [tier]="tier()"
    />
    <button id="elsewhere" type="button">Elsewhere</button>
  `,
})
class Host {
  readonly worktree = signal<Worktree>(WORKTREE);
  readonly compact = signal(false);
  readonly interactive = signal(true);
  readonly mismatch = signal(false);
  readonly source = signal<SpecSource>('main');
  readonly tier = signal<SheetTier>('wide');
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
  worktree: Worktree;
  compact: boolean;
  interactive: boolean;
  mismatch: boolean;
  source: SpecSource;
  tier: SheetTier;
}

async function render(set: Partial<Inputs> = {}) {
  const fixture = TestBed.createComponent(Host);
  const host = fixture.componentInstance;
  for (const [key, value] of Object.entries(set)) (host[key as keyof Inputs] as WritableSignal<unknown>).set(value);
  document.body.appendChild(fixture.nativeElement as HTMLElement);
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const chip = root.querySelector<HTMLElement>('ui-worktree-chip') ?? (() => { throw new Error('chip missing'); })();
  const text = (selector: string): string | undefined => chip.querySelector(selector)?.textContent.trim();
  return { fixture, root, chip, text, button: () => chip.querySelector<HTMLButtonElement>('button.trigger') };
}

const escape = (target: Element): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
};

const SENTENCE =
  'Worktree .worktrees/027-worktree-live-view, branch feature/027-worktree-live-view, 2 commits ahead of main, uncommitted changes';

describe('UiWorktreeChip', () => {
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

  it('full form: a neutral ui-chip with the 14 px git-branch, the branch split into muted prefix and NNN-slug, ↑n and ±', async () => {
    const { chip, text } = await render();

    expect(chip.getAttribute('data-form')).toBe('full');
    expect(chip.querySelector('ui-chip')?.getAttribute('data-tone')).toBe('neutral');
    expect(chip.querySelector('ui-icon[data-icon="git-branch"] svg')?.getAttribute('width')).toBe('14');
    expect(text('.prefix')).toBe('feature/');
    expect(text('.num')).toBe('027');
    expect(text('.tail')).toBe('-worktree-live-view');
    expect(text('.ahead')).toBe('↑2');
    expect(text('.dirty')).toBe('±');
  });

  it('shows ↑0 and leaves the ± out when the worktree is clean', async () => {
    const { text, chip } = await render({ worktree: { ...WORKTREE, ahead: 0, dirty: false } });

    expect(text('.ahead')).toBe('↑0');
    expect(chip.querySelector('.dirty')).toBeNull();
  });

  it('names the chip in one sentence, in English and German, singular for one commit', async () => {
    const { fixture, button } = await render();

    expect(button()?.getAttribute('aria-label')).toBe(SENTENCE);

    fixture.componentInstance.worktree.set({ ...WORKTREE, ahead: 1, dirty: false });
    await fixture.whenStable();
    expect(button()?.getAttribute('aria-label')).toBe(
      'Worktree .worktrees/027-worktree-live-view, branch feature/027-worktree-live-view, 1 commit ahead of main',
    );

    fixture.componentInstance.worktree.set(WORKTREE);
    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();
    expect(button()?.getAttribute('aria-label')).toBe(
      'Worktree .worktrees/027-worktree-live-view, Branch feature/027-worktree-live-view, 2 Commits vor main, uncommittete Änderungen',
    );
  });

  it('turns the whole chip to the warning tone on a worktree-branch-mismatch and says so in its name', async () => {
    const { chip, button } = await render({ mismatch: true });

    expect(chip.querySelector('ui-chip')?.getAttribute('data-tone')).toBe('warning');
    expect(button()?.getAttribute('aria-label')).toBe(`${SENTENCE}, branch does not match the worktree`);
  });

  it('compact form: 12 px git-branch, ↑n and ±, the branch only in the accessible name, no button when not interactive', async () => {
    const { chip, text, button } = await render({ compact: true, interactive: false });

    expect(chip.getAttribute('data-form')).toBe('compact');
    expect(chip.querySelector('ui-icon[data-icon="git-branch"] svg')?.getAttribute('width')).toBe('12');
    expect(text('.ahead')).toBe('↑2');
    expect(text('.dirty')).toBe('±');
    expect(button()).toBeNull();
    expect(chip.querySelector('button, [tabindex]')).toBeNull();
    expect(chip.querySelector('.face')?.getAttribute('aria-hidden')).toBe('true');
    expect(text('.vh')).toBe(SENTENCE);
    expect(chip.querySelector('[title]')?.getAttribute('title')).toBe('feature/027-worktree-live-view');
  });

  it('opens one popover with the details on click, closes on Escape and returns focus to the chip', async () => {
    const { fixture, chip, button } = await render({ source: 'worktree' });
    const trigger = button() ?? (() => { throw new Error('button missing'); })();

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    trigger.click();
    await fixture.whenStable();

    expect(api.showPopover).toHaveBeenCalledTimes(1);
    expect(chip.querySelector('ui-sheet')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const details = [...chip.querySelectorAll('ui-popover dd')].map((dd) => dd.textContent.trim());
    expect(details).toEqual([
      '.worktrees/027-worktree-live-view',
      'feature/027-worktree-live-view',
      '2 commits ahead of main',
      'Uncommitted changes',
      'Worktree copy',
    ]);
    expect(chip.querySelector('ui-popover')?.contains(document.activeElement)).toBe(true);

    escape(document.activeElement ?? trigger);
    await fixture.whenStable();

    expect(api.hidePopover).toHaveBeenCalledTimes(1);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('leaves the source row out when the spec is read from main and says clean when nothing is uncommitted', async () => {
    const { chip } = await render({ worktree: { ...WORKTREE, dirty: false } });

    const details = [...chip.querySelectorAll('ui-popover dd')].map((dd) => dd.textContent.trim());
    expect(details).toEqual(['.worktrees/027-worktree-live-view', 'feature/027-worktree-live-view', '2 commits ahead of main', 'Clean']);
  });

  it('below 640 px renders the same details as a bottom sheet, and Escape returns focus to the chip', async () => {
    const { fixture, chip, button } = await render({ tier: 'compact' });
    const trigger = button() ?? (() => { throw new Error('button missing'); })();

    expect(chip.querySelector('ui-popover')).toBeNull();
    trigger.focus();
    trigger.click();
    await fixture.whenStable();

    expect(api.showModal).toHaveBeenCalledTimes(1);
    expect(api.showPopover).not.toHaveBeenCalled();
    expect(chip.querySelector('ui-sheet')?.getAttribute('data-tier')).toBe('compact');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(chip.querySelectorAll('ui-sheet dd')).toHaveLength(4);

    const inside = chip.querySelector<HTMLElement>('ui-sheet button.copy') ?? trigger;
    inside.focus();
    escape(inside);
    await fixture.whenStable();

    expect(api.close).toHaveBeenCalledTimes(1);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('copies the worktree path from the details', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { fixture, chip, button } = await render();
    button()?.click();
    await fixture.whenStable();

    chip.querySelector<HTMLButtonElement>('ui-popover button.copy')?.click();
    await fixture.whenStable();

    expect(writeText).toHaveBeenCalledWith('.worktrees/027-worktree-live-view');
  });

  describe('a worktree outside the repository (spec 041, ISC-216)', () => {
    const OUTSIDE: Worktree = { ...WORKTREE, path: null };

    it('names it outside the repository and leaves the path row and the copy action out of the details', async () => {
      const { fixture, chip, button } = await render({ worktree: OUTSIDE });
      expect(button()?.getAttribute('aria-label')).toBe(
        'Worktree outside the repository, branch feature/027-worktree-live-view, 2 commits ahead of main, uncommitted changes',
      );
      button()?.click();
      await fixture.whenStable();

      const terms = [...chip.querySelectorAll('ui-popover dt')].map((dt) => dt.textContent.trim());
      expect(terms).toEqual(['Branch', 'Commits', 'Working tree']);
      expect(chip.querySelector('ui-popover dd.path')).toBeNull();
      expect(chip.querySelector('ui-popover button.copy')).toBeNull();
      expect(chip.querySelector('ui-popover .mono:empty')).toBeNull();
      expect(chip.textContent).not.toContain('null');
    });

    it('leaves the path out of the compact sheet as well', async () => {
      const { fixture, chip, button } = await render({ worktree: OUTSIDE, tier: 'compact' });
      button()?.click();
      await fixture.whenStable();
      expect(chip.querySelectorAll('ui-sheet dd')).toHaveLength(3);
      expect(chip.querySelector('ui-sheet button.copy')).toBeNull();
    });

    it('titles the static chip with the branch, and with the neutral word when the branch is detached too', async () => {
      const { fixture, chip } = await render({ worktree: OUTSIDE, interactive: false });
      expect(chip.querySelector('.static')?.getAttribute('title')).toBe('feature/027-worktree-live-view');

      fixture.componentInstance.worktree.set({ ...OUTSIDE, branch: null });
      await fixture.whenStable();
      expect(chip.querySelector('.static')?.getAttribute('title')).toBe('Worktree');
      expect(chip.querySelector('.static .vh')?.textContent.trim()).toBe(
        'Worktree outside the repository, detached HEAD, 2 commits ahead of main, uncommitted changes',
      );
      expect(chip.textContent).not.toContain('null');
    });

    it('words it in German', async () => {
      const { fixture, button } = await render({ worktree: OUTSIDE });
      TestBed.inject(TranslocoService).setActiveLang('de');
      await fixture.whenStable();
      expect(button()?.getAttribute('aria-label')).toContain('Worktree ausserhalb des Repositorys, Branch feature/027-worktree-live-view');
    });
  });
});
