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
  styles: `
    :host { display: block; min-inline-size: 0; }
    ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .o-line { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 4px 8px; align-items: start; min-block-size: 28px; font-size: 13px; line-height: 20px; }
    .o-line:focus { outline: none; }
    .warn-icon { margin-block-start: 2px; color: var(--color-warning); }
    .o-body { display: grid; gap: 2px; min-inline-size: 0; }
    .o-text { margin: 0; overflow-wrap: anywhere; }
    .spec { color: var(--disp-text); font-family: var(--font-mono); font-variant-numeric: tabular-nums; text-decoration: none; }
    .spec:hover { text-decoration: underline; text-underline-offset: 3px; }
    .o-paths { gap: 0; color: var(--muted-ink); font-family: var(--font-mono); font-size: 12px; line-height: 16px; }
    /* The prototype's .path: one line, cut at the start so the file name stays visible. */
    /* Spec 021 T37 (ISC-250): \`end\` of the rtl run is the left edge, so the paths stand left-aligned under their line. */
    .path { overflow: hidden; max-inline-size: 100%; direction: rtl; text-align: end; text-overflow: ellipsis; white-space: nowrap; }
    .path bdi { direction: ltr; }
    .more { justify-self: start; min-block-size: 32px; padding: 0; border: 0; background: none; color: var(--muted-ink); font-size: 12px; cursor: pointer; text-decoration: underline dotted; text-underline-offset: 3px; }
    @media (pointer: coarse) { .more { min-block-size: 44px; } }
    .more ui-icon { vertical-align: -2px; }
    /* The edge chip under the paths of its line, never right-aligned away from them (T37). */
    .o-edge { grid-column: 2; justify-self: start; }
    details > summary { padding-block: 4px; color: var(--muted-ink); font-size: 12px; line-height: 20px; cursor: pointer; }
    details > ul { margin-block-start: 8px; }
    .o-short { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 8px; font-size: 13px; line-height: 20px; }
    .o-short .o-body { display: flex; flex-wrap: wrap; gap: 0 8px; }
    .anchor { color: var(--disp-text); font-size: 12px; }
  `,
  template: `
    @if (form() === 'short') {
      <ul [attr.aria-label]="'warnings.overlap.region' | transloco">
        @for (line of lines(); track line.other) {
          <li class="o-short" data-overlap-short [attr.data-overlap-with]="line.other">
            <ui-icon class="warn-icon" name="triangle-alert" [size]="16" [label]="'warnings.icon' | transloco" />
            <span class="o-body">
              <span class="o-text">{{ lead(line) | transloco: { count: line.paths.length } }} <span class="spec">{{ line.other }}</span></span>
              <a
                class="anchor"
                data-overlap-anchor
                [routerLink]="[]"
                [fragment]="'overlap-' + line.other"
                [queryParams]="openHead()"
                queryParamsHandling="merge"
                >{{
                'warnings.overlap.toHead' | transloco
              }}</a>
            </span>
          </li>
        }
      </ul>
    } @else {
      <ul [attr.aria-label]="'warnings.overlap.region' | transloco">
        @for (line of shownLines(); track line.other) {
          <ng-container [ngTemplateOutlet]="full" [ngTemplateOutletContext]="{ $implicit: line }" />
        }
      </ul>
      @if (rest().length > 0) {
        <details data-overlaps-more>
          <summary>{{ (rest().length === 1 ? 'warnings.overlap.moreOverlaps.one' : 'warnings.overlap.moreOverlaps.other') | transloco: { count: rest().length } }}</summary>
          <ul>
            @for (line of rest(); track line.other) {
              <ng-container [ngTemplateOutlet]="full" [ngTemplateOutletContext]="{ $implicit: line }" />
            }
          </ul>
        </details>
      }
    }

    <ng-template #full let-line>
      <li
        class="o-line"
        data-overlap-line
        tabindex="-1"
        [attr.id]="anchors() ? 'overlap-' + line.other : null"
        [attr.data-overlap-with]="line.other"
        [attr.data-overlap-waiting]="line.waiting ? '' : null"
      >
        <ui-icon class="warn-icon" name="triangle-alert" [size]="16" [label]="'warnings.icon' | transloco" />
        <div class="o-body">
          <p class="o-text" data-overlap-text>{{ lead(line) | transloco: { count: line.paths.length } }} <a class="spec" data-overlap-other [routerLink]="otherLink(line.other)">{{ line.other }}</a>, {{ 'warnings.overlap.noEdge' | transloco }}</p>
          <ul class="o-paths" data-overlap-paths>
            @for (path of shownPaths(line); track $index) {
              <li class="path" data-overlap-path [title]="path"><bdi>{{ path }}</bdi></li>
            }
          </ul>
          @if (fold() && line.paths.length > openPaths && !expanded().has(line.other)) {
            <button type="button" class="more" data-overlap-more [attr.aria-expanded]="false" (click)="expand(line.other)">
              {{ (line.paths.length - openPaths === 1 ? 'warnings.overlap.more.one' : 'warnings.overlap.more.other') | transloco: { count: line.paths.length - openPaths } }}
              <ui-icon name="chevron-down" [size]="12" />
            </button>
          }
        </div>
        <ui-command-chip
          class="o-edge"
          data-overlap-edge
          [command]="line.edge"
          [copyLabel]="'warnings.overlap.copyTitle' | transloco"
          [copiedLabel]="'common.copied' | transloco: { command: line.edge }"
          [manualHint]="'common.copyFallback' | transloco"
        />
      </li>
    </ng-template>
  `,
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
