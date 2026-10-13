import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
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
  protected readonly rows = inject(DemoData).workspaces;
  protected readonly count = computed(() => this.rows().length);

  /** What the add row's path and name fields hold; local to the page, never stored. */
  protected readonly path = signal('');
  protected readonly name = signal('');
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
    this.tried.set(false);
    const tail = value.split('/').filter(Boolean).pop() ?? '';
    this.name.set(tail);
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
