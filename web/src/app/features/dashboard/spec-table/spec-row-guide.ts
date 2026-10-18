import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { GuidanceEntry } from '../../../../../../core/src/files';
import { GuidanceReasonPipe } from '../../../shared/ui/guidance/guidance-reason.pipe';
import { UiChip } from '../../../shared/ui/chip/chip';
import { UiCommandChip } from '../../../shared/ui/command-chip/command-chip';
import { UiGlyph } from '../../../shared/ui/glyph/glyph';

/**
 * The reason row of a Specs-table row whose spec has its own guidance entry (spec 020, T26, ISC-240; design.md
 * § Workspace-Dashboard): "mark · sentence · chip" for an entry in "Waits on you", "ring · sentence · chip" for one in
 * Next. The mark is a secondary status chip with the visible word, never colour alone; the sentence is the entry's
 * catalogue sentence (`guidanceReason`, the same on every surface), wrapping on whole words and never clamped; the chip
 * copies the entry's command. Below 560 px of row the three stack (mark, sentence, chip); wider, the chip sits at the
 * end of the line, top-aligned with the sentence's first line.
 */
@Component({
  selector: 'app-spec-row-guide',
  imports: [GuidanceReasonPipe, TranslocoPipe, UiChip, UiCommandChip, UiGlyph],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-guide]': 'waits() ? "waits" : "next"' },
  styles: `
    :host { display: block; min-inline-size: 0; container: row-guide / inline-size; }
    .line { display: grid; gap: 8px; justify-items: start; align-items: start; min-inline-size: 0; }
    .sentence { display: flex; gap: 6px; align-items: flex-start; min-inline-size: 0; color: var(--color-base-content); font-size: 13px; line-height: 20px; overflow-wrap: break-word; }
    .sentence ui-glyph { padding-block-start: 3px; }
    @container row-guide (min-inline-size: 560px) {
      .line { grid-template-columns: auto minmax(0, 1fr) auto; column-gap: 12px; }
      .line:not(:has(.mark)) { grid-template-columns: minmax(0, 1fr) auto; }
    }
  `,
  template: `
    <div class="line">
      @if (waits()) {
        <ui-chip class="mark" variant="status" tone="secondary" icon="user-round" data-waits-mark>{{ 'guidance.marker' | transloco }}</ui-chip>
      }
      <span class="sentence">
        @if (!waits()) {
          <ui-glyph state="open" family="item" [size]="14" />
        }
        <span data-guide-sentence>{{ entry().reason | guidanceReason }}</span>
      </span>
      @if (entry().command; as command) {
        <ui-command-chip
          [command]="command"
          [copyLabel]="'common.copyCommand' | transloco"
          [copiedLabel]="'common.copied' | transloco: { command }"
          [manualHint]="'common.copyFallback' | transloco"
        />
      }
    </div>
  `,
})
export class SpecRowGuide {
  /** The spec's own guidance entry (`guidanceEntryOf`). */
  readonly entry = input.required<GuidanceEntry>();
  /** True when the entry stands in `guidance.waits`: the row then carries the "Waits on you" mark. */
  readonly waits = input(false);
}
