import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { LockSourceService } from '../../core/lock-source.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiIconButton } from '../../shared/ui/button/icon-button';
import { UiKbd } from '../../shared/ui/kbd/kbd';
import { TabBarSlot } from '../tab-bar/tab-bar-slot';
import { specLink } from './areas';
import { ShellData } from './shell-data.service';
import { ShellState } from './shell-state.service';

/**
 * The shell header (ISC-73): one `<header>`, 64 px sticky, one row at medium and wide, two rows at compact (row 2 is
 * the area menu, the tab-bar slot and zen). Every control carries `data-control` so T36 (pickers, palette field,
 * live indicator), T37 (area menu) and T38 (zen) replace it in place. Controls whose task has not landed are
 * `aria-disabled` with their reason as `title`; brand, workspace, spec and zen already work.
 */
@Component({
  selector: 'app-shell-header',
  imports: [RouterLink, TranslocoPipe, UiIcon, UiIconButton, UiKbd, TabBarSlot],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell-header.html',
  styleUrl: './shell-header.css',
  host: { '[attr.data-zen]': "state.zen() ? '' : null" },
})
export class ShellHeader {
  protected readonly state = inject(ShellState);
  protected readonly data = inject(ShellData);
  private readonly lockSource = inject(LockSourceService);
  private readonly router = inject(Router);

  protected readonly workspaceName = computed(() => {
    const ws = this.state.ws();
    return ws === null ? null : this.data.workspaceName(ws);
  });
  protected readonly workspaceCount = computed(() => this.data.workspaceList().length);
  protected readonly specCount = computed(() => this.data.specRows().length);
  protected readonly row = this.data.currentRow;
  protected readonly specOpen = computed(() => this.state.specId() !== null && !this.data.specMissing());
  protected readonly areaKey = computed(() => `shell.areas.${this.state.area() ?? 'dashboard'}`);
  protected readonly source = this.lockSource.source;
  protected readonly liveKey = computed(() => `shell.live.source.${this.lockSource.source()}`);

  protected openWorkspace(): void {
    const ws = this.state.ws();
    void this.router.navigate(ws === null ? ['/'] : ['/w', ws]);
  }

  protected openSpec(): void {
    const ws = this.state.ws();
    const id = this.state.specId();
    if (ws !== null && id !== null) void this.router.navigate(specLink(ws, id));
    else if (ws !== null) void this.router.navigate(['/w', ws]);
  }
}
