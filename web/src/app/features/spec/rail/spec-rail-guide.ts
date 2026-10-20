import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { SpecPageModel } from '../../../../../../core/src/files';
import { specLink } from '../../../layout/shell/areas';
import { ShellData } from '../../../layout/shell/shell-data.service';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { specGuide } from '../../../layout/spec-head/spec-guide';
import { UiChip } from '../../../shared/ui/chip/chip';
import { UiCommandChip } from '../../../shared/ui/command-chip/command-chip';
import { GuidanceReasonPipe } from '../../../shared/ui/guidance/guidance-reason.pipe';
import { UiWaitsBlock } from '../../../shared/ui/guidance/waits-block';

/**
 * The rail's guidance spot from 1120 px (spec 020, T20, ISC-239; design.md § Spec-Seite): "Next step" with the spec's
 * catalogue sentence (`guidanceReason`), its copy chip and the marker "Waits on you" when the spec itself waits on you;
 * then the spec's other waiting entries as `ui-waits-block` (scope `spec`: `ISC-n` / `Tn` instead of the spec number,
 * limit 5, a chip on every row, "+n more" to the spec dashboard's `#waiting`), with no `operator` checkbox: the rail
 * leads, the Tasks tab ticks. One markup for every rail of the spec page: the spec rail (`app-spec-rail`) and the spec
 * dashboard's own rail (its Spec context) both open with it. The host is `display: contents`, so its blocks are items
 * of the rail's grid. It renders the spec payload the shell already loads (`ShellData.spec`) as it is.
 */
@Component({
  selector: 'app-spec-rail-guide',
  imports: [GuidanceReasonPipe, TranslocoPipe, UiChip, UiCommandChip, UiWaitsBlock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: contents; }
    .sr-card {
      display: grid;
      gap: 12px;
      align-content: start;
      min-inline-size: 0;
      padding: 16px;
      border: 1px solid var(--line);
      border-radius: var(--radius-box);
      background: var(--color-base-100);
      color: var(--color-base-content);
    }
    .sr-head { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
    .sr-eyebrow { margin: 0; color: var(--muted-ink); font-size: 11px; font-weight: 600; line-height: 16px; letter-spacing: 0.08em; text-transform: uppercase; }
    .sr-sentence { margin: 0; font-size: 15px; line-height: 24px; overflow-wrap: break-word; }
  `,
  template: `
    @if (guide(); as g) {
      <section class="sr-card" data-rail-block="next" aria-labelledby="spec-rail-next">
        <div class="sr-head">
          <h2 id="spec-rail-next" class="sr-eyebrow">{{ 'guidance.next.step' | transloco }}</h2>
          @if (g.waiting) {
            <ui-chip variant="small" tone="secondary" icon="user-round" data-rail-marker>{{ 'guidance.marker' | transloco }}</ui-chip>
          }
        </div>
        <p class="sr-sentence" data-rail-reason>{{ g.entry?.reason | guidanceReason: g.phrase }}</p>
        @if (g.command; as command) {
          <ui-command-chip
            data-rail-next
            [command]="command"
            [context]="'orientation.chipContext.railGuide' | transloco: { spec: specId() }"
            [copyLabel]="'common.copyCommand' | transloco"
            [copiedLabel]="'common.copied' | transloco: { command }"
            [manualHint]="'common.copyFallback' | transloco"
          />
        }
      </section>
      @if (g.others.length > 0) {
        <ui-waits-block
          data-rail-block="waits"
          scope="spec"
          headingId="spec-rail-waits"
          [entries]="g.others"
          [workspace]="ws()"
          [limit]="5"
          [chips]="true"
          [moreLink]="dashboardLink()"
        />
      }
    }
  `,
})
export class SpecRailGuide {
  private readonly data = inject(ShellData);
  private readonly state = inject(ShellState);

  private readonly model = computed<SpecPageModel | null>(() => {
    const result = this.data.spec.value();
    return result?.kind === 'ok' ? result.body : null;
  });

  /** The guidance spot: the spec's own entry as the next step and the rest of its `waits` (`specGuide`). */
  protected readonly guide = computed(() => {
    const model = this.model();
    return model === null ? null : specGuide(model.guidance, model);
  });

  protected readonly ws = computed(() => this.state.ws() ?? '');
  /** The open spec's id: the rail guide's chip says whose next step it copies (spec 057, ISC-354). */
  protected readonly specId = computed(() => this.model()?.head.id ?? this.state.specId() ?? '');
  /** "+n more" leads to the spec dashboard, whose `#waiting` lists every waiting entry of the spec. */
  protected readonly dashboardLink = computed(() => specLink(this.ws(), this.model()?.head.id ?? this.state.specId() ?? '').join('/'));
}
