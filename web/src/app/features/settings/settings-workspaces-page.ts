import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ShellState } from '../../layout/shell/shell-state.service';
import { DemoData, type DemoWorkspaceRow } from '../../shared/demo/demo-data';
import { UiIcon } from '../../shared/icons/icon';
import { UiButton } from '../../shared/ui/button/button';
import { UiIconButton } from '../../shared/ui/button/icon-button';
import { UiCard } from '../../shared/ui/card/card';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiKbd } from '../../shared/ui/kbd/kbd';
import { UiDialog } from '../../shared/ui/overlay/dialog';
import { UiPopover, UiPopoverTrigger } from '../../shared/ui/overlay/popover';
import { UiPageHead } from '../../shared/ui/page-head/page-head';
import { UiRelativeTime } from '../../shared/ui/relative-time/relative-time';

/** The row's status word and tone (prototype `pages.js` `statusTxt`): readable, no specs yet, folder not found. */
type RowStatus = 'ok' | 'empty' | 'missing';

/** The prototype's workspace accents in row order (`--cyan`, `--lime`, `--violet`, `--orange`), as app tokens. */
const ACCENTS: ReadonlyArray<{ readonly color: string; readonly text: string }> = [
  { color: 'var(--color-primary)', text: 'var(--disp-text)' },
  { color: 'var(--color-accent)', text: 'var(--clos-text)' },
  { color: 'var(--color-secondary)', text: 'var(--ques-text)' },
  { color: 'var(--color-warning)', text: 'var(--hover-text)' },
];

/**
 * `/settings/workspaces`, the workspace management (spec 024, T52; prototype `workspaces.html`), a mock until the
 * registry's own spec delivers it: the page root is `[data-demo]` with the demo chip in its h1, and every row comes
 * from `DemoData.workspaces`. Nothing here writes: the add row, the row menu (Rename, Re-scan, Open dashboard,
 * Remove…) and the remove dialog only show what the real page will do, and the identity upload is disabled inside a
 * `[data-demo]` of its own. No request, no storage (ISC-149.1, `parity.spec.ts` group `demo`).
 */
@Component({
  selector: 'app-settings-workspaces-page',
  imports: [
    TranslocoPipe,
    UiButton,
    UiCard,
    UiChip,
    UiCommandChip,
    UiDialog,
    UiIcon,
    UiIconButton,
    UiKbd,
    UiPageHead,
    UiPopover,
    UiPopoverTrigger,
    UiRelativeTime,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'settings-workspaces', 'data-demo': '' },
  templateUrl: './settings-workspaces-page.html',
  styleUrl: './settings-workspaces-page.css',
})
export class SettingsWorkspacesPage {
  private readonly demo = inject(DemoData);
  protected readonly rows = this.demo.workspaces;
  /** Below 640 the add action is the floating button (prototype `.fab.only-compact`). */
  private readonly shell = inject(ShellState);
  protected readonly compact = computed(() => this.shell.tier() === 'compact');
  protected readonly count = computed(() => this.rows().length);

  /** What the add row's path and name fields hold; local to the page, never stored. */
  protected readonly path = signal('');
  protected readonly name = signal('');
  /** The path completion (prototype `.path-pop`): open while the field has focus, the highlighted option or -1. */
  readonly popOpen = signal(false);
  protected readonly sel = signal(-1);
  /** Up to six demo folders under the typed segment, other than the typed path itself (prototype `complete()`). */
  protected readonly completions = computed(() => {
    const value = this.path();
    const head = value.slice(0, value.lastIndexOf('/') + 1);
    return this.demo
      .folders()
      .filter((folder) => folder.startsWith(head) && folder !== value)
      .slice(0, 6)
      .map((folder) => ({ path: folder, head, tail: folder.slice(head.length) }));
  });
  protected readonly popShown = computed(() => this.popOpen() && this.completions().length > 0);

  /** Set once Add was pressed: the check line says the mock adds nothing. */
  protected readonly tried = signal(false);

  /** The row the remove dialog asks about; the dialog changes nothing either way. */
  protected readonly removing = signal<DemoWorkspaceRow | null>(null);
  protected readonly removeOpen = signal(false);

  protected readonly command = 'spectant add | list | remove';

  protected status(row: DemoWorkspaceRow): RowStatus {
    if (row.state === 'missing') return 'missing';
    return row.specs === 0 ? 'empty' : 'ok';
  }

  protected accent(index: number): { readonly color: string; readonly text: string } {
    return ACCENTS[index % ACCENTS.length] ?? { color: 'var(--color-primary)', text: 'var(--disp-text)' };
  }

  protected initials(name: string): string {
    return name.replace(/[^a-z0-9]/giu, '').slice(0, 2).toUpperCase();
  }

  /** The path field fills an empty name with the path's last segment, as the prototype does. */
  protected setPath(value: string): void {
    this.path.set(value);
    this.sel.set(-1);
    this.tried.set(false);
    const tail = value.split('/').filter(Boolean).pop() ?? '';
    this.name.set(tail);
  }

  /** ↓ ↑ move through the completions, Enter takes the highlighted one or adds, Esc closes the list. */
  protected onPathKey(event: KeyboardEvent): void {
    const count = this.completions().length;
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && count > 0) {
      event.preventDefault();
      this.popOpen.set(true);
      this.sel.update((sel) => (sel + (event.key === 'ArrowDown' ? 1 : -1) + count + (sel < 0 && event.key === 'ArrowUp' ? 1 : 0)) % count);
    } else if (event.key === 'Enter') {
      const item = this.popShown() ? this.completions()[this.sel()] : undefined;
      if (item) {
        event.preventDefault();
        this.pick(item.path);
      } else this.add();
    } else if (event.key === 'Escape' && this.popShown()) {
      event.preventDefault();
      this.popOpen.set(false);
    }
  }

  /** A completion taken: the path and the name follow it, the list shows what lies below it. */
  protected pick(folder: string): void {
    this.setPath(folder);
    this.sel.set(-1);
    this.popOpen.set(true);
  }

  /** The mock's Add: it says it added nothing, and the rows stay as they are. */
  protected add(): void {
    this.tried.set(true);
  }

  protected askRemove(row: DemoWorkspaceRow, menu: UiPopover): void {
    menu.close();
    this.removing.set(row);
    this.removeOpen.set(true);
  }
}
