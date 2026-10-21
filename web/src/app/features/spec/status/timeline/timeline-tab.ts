import { afterRenderEffect, ChangeDetectionStrategy, Component, ElementRef, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { TimelineEntry, TimelineKind } from '../../../../../../../core/src/files';
import { UiButton } from '../../../../shared/ui/button/button';
import { UiChip } from '../../../../shared/ui/chip/chip';
import { UiEmptyState } from '../../../../shared/ui/empty-state/empty-state';
import { UiNotice } from '../../../../shared/ui/notice/notice';
import { UiIcon } from '../../../../shared/icons/icon';
import type { IconName } from '../../../../shared/icons/icons';
import { UiDisclosure } from '../../../../shared/ui/overlay/disclosure';
import { UiRovingItem, UiRovingList } from '../../../../shared/ui/roving-list.directive';
import { UiTime } from '../../../../shared/time';
import { UiSkeleton } from '../../../../shared/ui/skeleton/skeleton';
import { UiTerm } from '../../../../shared/ui/term/term';
import { toneMark } from '../../../../shared/ui/tone';
import type { TimelineRow } from './timeline-model';
import { TimelineStore } from './timeline.store';

// The day grouping and the source list moved to `timeline-model.ts` (spec 061); the spec imports them from here.
export { groupByDay, parseKinds, TIMELINE_KINDS, type TimelineDay, type TimelineRow } from './timeline-model';

/**
 * One marker colour per source (`.mk.*`): stage → disp, decision → ques, round → conc, gate → clos, commit →
 * track, note → a ques ring on its tint (the tint is the CSS's), agent → the orange (`--color-warning`),
 * worktree → neutral (spec 027).
 */
const MARKER: Record<TimelineKind, string> = {
  stage: toneMark('primary'),
  decision: toneMark('secondary'),
  round: 'var(--conc)',
  gate: toneMark('accent'),
  commit: 'var(--track)',
  note: toneMark('secondary'),
  agent: 'var(--color-warning)',
  worktree: toneMark('neutral'),
};

/** The glyph inside a worktree entry's marker (spec 027, ISC-175.1): merged into main, or the worktree removed. */
const WORKTREE_GLYPH: Readonly<Record<'merged' | 'removed', IconName>> = { merged: 'git-merge', removed: 'folder-x' };

/** A `Landed in` part that names a spec file opens that file's tab, as the Docs tab's file chips do. */
const FILE_TABS: Readonly<Record<string, string>> = { 'spec.md': 'status', 'plan.md': 'plan', 'design.md': 'design', 'tasks.md': 'tasks', 'context.md': 'decisions' };

/**
 * T55 · ISC-80 · ISC-36: the Status area's Timeline tab. One strand, newest first, grouped by local day with sticky
 * labels; source filters as toggle chips kept in `?kinds=`; an entry with a body expands in place (round entries add
 * "Open board"); a derived stage transition carries a dashed marker and a `derived` chip; `#t/<id>` scrolls to,
 * highlights and opens that entry. A `worktree` entry (spec 027, ISC-175.1) is worded here from its git facts, derived
 * like a stage transition, its glyph in the dashed marker, without a body. Entries are one roving list: arrows move, Enter toggles the entry's body.
 * The state lives in `TimelineStore` (spec 061), one per tab; the page keeps the deep-link scroll and the entry's
 * presentation helpers.
 */
@Component({
  selector: 'app-timeline-tab',
  imports: [NgTemplateOutlet, TranslocoPipe, RouterLink, UiButton, UiChip, UiDisclosure, UiIcon, UiEmptyState, UiNotice, UiRovingItem, UiRovingList, UiSkeleton, UiTerm, UiTime],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './timeline-tab.html',
  styleUrls: ['./timeline-tab.css', './timeline-tab-entry.css'],
  host: { 'data-page': 'timeline' },
  providers: [TimelineStore],
})
export class TimelineTab {
  protected readonly store = inject(TimelineStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly markerColor = (kind: TimelineKind): string => MARKER[kind];
  protected worktreeGlyph(entry: TimelineEntry): IconName | null {
    return entry.worktree ? WORKTREE_GLYPH[entry.worktree.state] : null;
  }
  /**
   * What a worktree entry's title names after its words: the branch when merged, the worktree's path when removed. A
   * worktree outside the repository carries no path (spec 041, ISC-216): the branch stands in, and with neither the
   * title ends after its words.
   */
  protected worktreeRef(entry: TimelineEntry): string | null {
    const worktree = entry.worktree;
    if (worktree === undefined) return null;
    return worktree.state === 'merged' ? worktree.branch : (worktree.path ?? worktree.branch);
  }
  protected fileTab(part: string): string | null {
    return FILE_TABS[part] ?? null;
  }
  /** A running agent's minutes since its lock (`· running 4 min`), at render time, never below 0. */
  protected runningMinutes(ts: string): number {
    const since = Date.parse(ts);
    return Number.isFinite(since) ? Math.max(0, Math.floor((Date.now() - since) / 60_000)) : 0;
  }
  /** A decision's structured body: shown as the `.qa` list when the question records any field. */
  protected hasQa(entry: TimelineEntry): boolean {
    const q = entry.question;
    return q !== undefined && (q.from !== null || q.offered.length > 0 || q.chosen !== null || q.landedIn.length > 0);
  }

  private scrolledTo: string | null = null;

  constructor() {
    // Scroll a deep-linked entry into view once, after the rows it names have rendered.
    afterRenderEffect(() => {
      const target = this.store.target();
      if (target === null || this.store.view() !== 'ok' || this.scrolledTo === target) return;
      const element = this.host.nativeElement.querySelector<HTMLElement>(`[data-id="${CSS.escape(target)}"]`);
      if (element === null) return;
      this.scrolledTo = target;
      // DOM emulations (the unit-test builder) have no scrollIntoView.
      (element as Partial<HTMLElement>).scrollIntoView?.({ block: 'center' });
      element.focus({ preventScroll: true });
    });
  }

  /** Enter on the entry itself (not on a control inside it) toggles its body. */
  onEntryKey(event: KeyboardEvent, row: TimelineRow): void {
    if (event.key !== 'Enter' || event.target !== event.currentTarget || !row.entry.body) return;
    event.preventDefault();
    this.store.setOpen(row.key, !this.store.isOpen(row.key));
  }

  /** The body as plain lines (markdown-lite, never HTML). */
  protected lines(body: string): string[] {
    return body.split('\n');
  }
}
