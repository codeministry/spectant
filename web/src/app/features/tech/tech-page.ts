import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { TechModel } from '../../../../../core/src/files';
import { NotFound } from '../../layout/not-found/not-found';
import { type TechTabCountValues, TechTabCounts, type TechTabId } from '../../layout/shell/page-tabs';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { TabBarSlot } from '../../layout/tab-bar/tab-bar-slot';
import { UiNotice } from '../../shared/ui/notice/notice';
import { UiSkeleton } from '../../shared/ui/skeleton/skeleton';
import { TechDocsTab } from './tech-docs-tab';
import { TechOpenTab } from './tech-open-tab';
import { TechSpecsTab } from './tech-specs-tab';
import { TechStatusTab } from './tech-status-tab';

/**
 * The tab figures of a tech model (design.md § Tabs): Status and Specs count the specs, Open the `- fog:` lines of the
 * specs not yet complete. Overview and Architecture carry none: there is nothing in the model to count.
 */
export function techTabCounts(model: TechModel): TechTabCountValues {
  const open = model.specs.filter((spec) => spec.phase !== 'complete').reduce((sum, spec) => sum + spec.fog.length, 0);
  return { status: model.specs.length, specs: model.specs.length, open };
}

/**
 * The tech page at `/w/:ws/tech/<tab>` (spec 023, T14, ISC-134.1): `readTech`'s model over `GET …/:ws/tech`, read
 * from `ShellData.tech` so the live refresh reloads it with the rest of the shell (an unchanged answer a 304), the page
 * head (title and the mono subline naming `specs/tech.md` and the spec count), the tab bar's main slot sticky under
 * the head at medium and wide (the header slot takes it at compact), then the current tab's panel. One instance stays
 * across tab switches: the tab routes are componentless children, so the panel follows `ShellState.techTab` and no
 * `<router-outlet>` is involved.
 *
 * The page fills `TechTabCounts`, the figures the tab bar shows wherever it renders, and empties them while a
 * workspace loads and when the page goes. An unknown workspace is the not-found page and an unreadable one the
 * shell's line, as on the board; a failed read is an error notice in the panel, head and tabs kept.
 *
 * Each panel is a placeholder `[data-tech-tab="<id>"]` until its tab component lands (T15 onwards); the tab
 * components take `model()` (the `TechModel`) and, for Status, the dashboard rows `ShellData` already holds.
 */
@Component({
  selector: 'app-tech-page',
  imports: [NotFound, TabBarSlot, TechDocsTab, TechOpenTab, TechSpecsTab, TechStatusTab, TranslocoPipe, UiNotice, UiSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'tech', '[attr.data-tab]': 'tab()' },
  styleUrl: './tech-page.css',
  templateUrl: './tech-page.html',
})
export class TechPage {
  private readonly state = inject(ShellState);
  private readonly data = inject(ShellData);
  private readonly counts = inject(TechTabCounts);

  /** The model as `ShellData.tech` serves it (refreshed with the shell); null while loading and for every answer but `ok`. */
  readonly model = this.data.techModel;
  private readonly result = this.data.techResult;

  protected readonly tab = computed<TechTabId>(() => this.state.techTab() ?? 'overview');

  /** The workspace or the tech route answered the contract's 404. */
  protected readonly missing = this.data.techMissing;
  protected readonly unavailable = computed(() => this.data.workspaceUnavailable() || this.result()?.kind === 'unavailable');
  /** The read failed: an error status, a thrown loader or a path no route answers (the catch-all 404). */
  protected readonly failed = computed(() => {
    const result = this.result();
    return this.data.tech.status() === 'error' || result?.kind === 'error' || (result?.kind === 'not-found' && !result.served);
  });

  constructor() {
    effect(() => {
      const model = this.model();
      this.counts.counts.set(model === null ? {} : techTabCounts(model));
    });
    inject(DestroyRef).onDestroy(() => this.counts.counts.set({}));
  }
}
