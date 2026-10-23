import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { StatusSpec } from '../../../../../server/src/contracts/status.contract';
import { UiAgentDot } from '../../shared/ui/agent-dot/agent-dot';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiRing } from '../../shared/ui/ring/ring';
import { toneOfStage } from '../../shared/ui/stage-tone';

/**
 * One row of the status widget (spec 071, T28, ISC-585; design.md § Mobile, Tablet, Desktop "Zeile"): a link over the
 * whole row to `/w/<ws>/s/<id>` with the text-less 24 px ring (a progressbar named "3 of 9 claims closed", solid lime
 * at 100 %), the spec number (mono, `--disp-text`), the title (one line with an ellipsis, the full text in `title`),
 * the counter `closed/total` and the stage chip in `toneOfStage()` with its dot and the word from `stages.*`, so a
 * closed spec differs in word and tone, never in colour alone. The link's name joins number, title, counter and stage.
 * One line from a 480 px `widget` container, two below. The click behaviour (opener or tab mode) is the page's.
 *
 * An open agent run (T29, ISC-594) adds the decorative `ui-agent-dot` at the ring's top end corner and "agent
 * running" to the link's name; the dot's ring stands still under reduced motion through the primitive.
 */
@Component({
  selector: 'app-status-widget-row',
  imports: [TranslocoPipe, UiAgentDot, UiChip, UiRing],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './status-widget-row.html',
  styleUrl: './status-widget-row.css',
})
export class StatusWidgetRow {
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  readonly spec = input.required<StatusSpec>();
  /** The workspace slug the row links in. */
  readonly ws = input.required<string>();

  protected readonly href = computed(() => `/w/${encodeURIComponent(this.ws())}/s/${encodeURIComponent(this.spec().id)}`);
  /** Closed over total claims in percent; null without claims, which leaves the ring without a value. */
  protected readonly percent = computed(() => {
    const { closed, total } = this.spec().claims;
    return total === 0 ? null : (closed / total) * 100;
  });
  protected readonly tone = computed(() => toneOfStage(this.spec().stage));
  protected readonly ringLabel = computed(() => {
    this.lang();
    const { closed, total } = this.spec().claims;
    return this.transloco.translate('common.claimsClosed', { closed, total });
  });
  /** Spec 071 (T29, ISC-594): an open agent run; it puts the decorative agent dot on the ring and names the run. */
  protected readonly running = computed(() => this.spec().state === 'running');
  protected readonly name = computed(() => {
    this.lang();
    const spec = this.spec();
    const stage = this.transloco.translate(`stages.${spec.stage}`);
    const name = `${spec.id} ${spec.title}, ${this.ringLabel()}, ${stage}`;
    return this.running() ? `${name}, ${this.transloco.translate('statusWidget.agentRunning')}` : name;
  });
}
