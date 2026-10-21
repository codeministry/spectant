import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { filter } from 'rxjs';
import { KeyboardService } from '../shell/keyboard.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiButton } from '../../shared/ui/button/button';
import { UiCard } from '../../shared/ui/card/card';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiKbd } from '../../shared/ui/kbd/kbd';
import { UiPageHead } from '../../shared/ui/page-head/page-head';
import { ShellData, type SpecRowView } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';

/** The `count` spec rows whose numeric id lies nearest to `id`, in id order; none when `id` is not a number. */
export function nearestSpecs(rows: readonly SpecRowView[], id: string, count = 3): SpecRowView[] {
  const target = Number.parseInt(id, 10);
  if (!Number.isFinite(target)) return [];
  const distance = (row: SpecRowView): number => Math.abs(Number.parseInt(row.id, 10) - target);
  const numbered = rows.filter((row) => Number.isFinite(Number.parseInt(row.id, 10)));
  const near = [...numbered].sort((a, b) => distance(a) - distance(b) || a.id.localeCompare(b.id)).slice(0, count);
  return near.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The not-found page (ISC-71; spec 024 T65, design.md § NotFound and the static prototype `not-found.html`): an
 * unknown path, workspace, spec or tab. No fallback and no redirect. The page head `SPECTANT · 404`, then one card:
 * the empty state (`compass` in its circle, "Nothing at this address", the path, why) with All workspaces, Search
 * (the palette) and, in a known workspace, the way back to it. A spec id the known workspace does not list is the
 * variant "Spec 099 is not in <ws>": the way back to the workspace dashboard first, then the three nearest spec ids.
 */
@Component({
  selector: 'app-not-found',
  imports: [RouterLink, TranslocoPipe, UiButton, UiCard, UiChip, UiIcon, UiKbd, UiPageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'not-found' },
  styleUrl: './not-found.css',
  templateUrl: './not-found.html',
})
export class NotFound {
  protected readonly state = inject(ShellState);
  private readonly data = inject(ShellData);
  protected readonly keyboard = inject(KeyboardService);

  /** The requested path, without query or fragment, as the router last settled on it. */
  protected readonly path = signal('');

  constructor() {
    const router = inject(Router);
    const strip = (url: string): string => url.split(/[?#]/u)[0] ?? url;
    this.path.set(strip(router.url));
    router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => this.path.set(strip(event.urlAfterRedirects)));
  }

  /** The open workspace when it exists (its dashboard answered). */
  protected readonly workspace = computed(() => {
    const ws = this.state.ws();
    if (ws === null || this.data.dashboard.value()?.kind !== 'ok') return null;
    return { slug: ws, name: this.data.workspaceName(ws) };
  });

  /** The variant: a spec id the known workspace does not list, with the nearest ids it does list. */
  protected readonly missingSpec = computed(() => {
    const workspace = this.workspace();
    const id = this.state.specId();
    if (workspace === null || id === null || !this.data.specMissing()) return null;
    return { ...workspace, id, nearest: nearestSpecs(this.data.specRows(), id) };
  });
}
