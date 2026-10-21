import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { OverlapLine } from '../../core/model/overlap';
import { UiIcon } from '../../shared/icons/icon';
import { OPEN_PARAM, OpenState, serializeOpen } from '../../shared/open-state';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { specLink } from '../shell/areas';

/** How many overlap lines stand open before the rest folds into "+n more overlaps", and paths per line before "+n". */
const OPEN_LINES = 2;
const OPEN_PATHS = 3;

/**
 * Spec 025 T29 (ISC-164.1): the overlap lines of one spec, each from its own side — the other spec as a link, the
 * shared paths (full, cut at the start so the file name stays, at most three, the rest unfolded in place by "+n
 * more") and the edge this spec could carry, with copy: on the waiting spec core's `(after: <other>)`, on the other
 * one the reverse. The human picks the direction (design.md § Desktop 2, § Mobile 1).
 *
 * `full`: the spec head's lines, each with the anchor `overlap-<other>`; `full` without `anchors` repeats them in the
 * spec context below 1120 px. `short`: the spec context beside the head from 1120 px, text and a link to the anchor.
 */
@Component({
  selector: 'app-overlap-lines',
  imports: [NgTemplateOutlet, RouterLink, TranslocoPipe, UiCommandChip, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-overlaps]': 'form()' },
  styleUrl: './overlap-lines.css',
  templateUrl: './overlap-lines.html',
})
export class OverlapLines {
  readonly lines = input.required<readonly OverlapLine[]>();
  /** The workspace slug for the other spec's link. */
  readonly ws = input.required<string>();
  readonly form = input<'full' | 'short'>('full');
  /** Whether the lines carry the `overlap-<other>` anchors; only the spec head's do, so each id exists once. */
  readonly anchors = input(true);
  /**
   * Spec 021 T37 (ISC-250): whether the full form folds lines past the second and paths past the third. The spec head
   * turns it off: its lines already sit in one collapsed overlaps disclosure, so a second fold inside would add nothing.
   */
  readonly fold = input(true);

  private readonly openState = inject(OpenState);

  protected readonly openPaths = OPEN_PATHS;
  protected readonly shownLines = computed(() => (this.fold() ? this.lines().slice(0, OPEN_LINES) : this.lines()));
  protected readonly rest = computed(() => (this.fold() ? this.lines().slice(OPEN_LINES) : []));
  protected readonly expanded = signal<ReadonlySet<string>>(new Set());
  /** The short form's anchor opens the head's overlaps disclosure, so the line it jumps to is not hidden (T37). */
  protected readonly openHead = computed(() => ({ [OPEN_PARAM]: serializeOpen([...this.openState.keys(), 'overlaps']) }));

  protected lead(line: OverlapLine): string {
    return line.paths.length === 1 ? 'warnings.overlap.headLead.one' : 'warnings.overlap.headLead.other';
  }

  protected otherLink(other: string): string[] {
    return specLink(this.ws(), other);
  }

  protected shownPaths(line: OverlapLine): readonly string[] {
    return !this.fold() || this.expanded().has(line.other) ? line.paths : line.paths.slice(0, OPEN_PATHS);
  }

  protected expand(other: string): void {
    this.expanded.update((set) => new Set([...set, other]));
  }
}
