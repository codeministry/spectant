import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIcon } from '../../shared/icons/icon';
import { UiCard } from '../../shared/ui/card/card';
import { LIFECYCLE, LIFECYCLE_TONES } from './help-sections';

/**
 * The lifecycle in two bands (prototype help "How a spec moves", `.flow-canvas`, `.wf-*`; spec 024 sweep): a dotted
 * canvas, "Shape & plan" and "Build & finish" with five nodes each (number, step, what it does, command, the file it
 * writes with `file`, the gate with `flag`, an optional step dotted with its `optional` pill), arrows between the
 * nodes, then the loops with `refresh-cw` and the tone legend. Static: the stages and commands come from core's stage
 * table, the optional steps from the Spec skill (`LIFECYCLE`).
 */
@Component({
  selector: 'app-help-lifecycle',
  imports: [TranslocoPipe, UiCard, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-card class="flow-canvas" data-lifecycle [padding]="24">
      <figure class="flow-figure" [attr.aria-label]="'help.lifecycle.label' | transloco">
        @for (band of lifecycle; track band.key; let first = $first) {
          @if (!first) {
            <div class="wf-turn" aria-hidden="true"><span></span>{{ 'help.lifecycle.continues' | transloco }}<span></span></div>
          }
          <div class="wf-band" [attr.data-band]="band.key">
            <div class="wf-band-head">
              <span class="eyebrow">{{ 'help.lifecycle.bands.' + band.key + '.title' | transloco }}</span>
              <span class="wf-sub">{{ 'help.lifecycle.bands.' + band.key + '.sub' | transloco }}</span>
            </div>
            <ol class="wf-row">
              @for (item of band.nodes; track item.stage; let i = $index) {
                <li class="wf-node" [attr.data-lifecycle-stage]="item.stage" [attr.data-tone]="item.tone" [attr.data-optional]="item.optional ? '' : null">
                  <span class="wf-num">{{ band.offset + i + 1 }}</span>
                  <b class="wf-st">{{ item.labelKey | transloco }}</b>
                  <p>{{ 'help.lifecycle.what.' + item.stage | transloco }}</p>
                  <code>{{ item.command ?? '—' }}</code>
                  <!-- One line on purpose: a break opportunity after each / and , only, never inside a name. -->
                  <span class="wf-file"><ui-icon name="file" [size]="12" /><span class="wf-path">@for (part of parts(item.file); track $index) {<span>{{ part }}</span><wbr />}</span></span>
                  @if (item.gate) {
                    <span class="wf-gate"><ui-icon name="flag" [size]="12" />{{ 'help.lifecycle.gates.' + item.stage | transloco }}</span>
                  }
                  @if (item.optional) {
                    <span class="wf-optional" data-optional-pill>{{ 'help.lifecycle.optional.' + item.stage | transloco }}</span>
                  }
                </li>
              }
            </ol>
          </div>
        }
        <figcaption class="wf-loops">
          <span class="eyebrow">{{ 'help.lifecycle.loops' | transloco }}</span>
          <span class="wf-loop" data-loop="blocked"><ui-icon name="refresh-cw" [size]="13" />{{ 'help.lifecycle.loopBlocked' | transloco }}</span>
          <span class="wf-loop" data-loop="reviewed"><ui-icon name="refresh-cw" [size]="13" />{{ 'help.lifecycle.loopReviewed' | transloco }}</span>
          <span class="wf-loop" data-loop="pending"><ui-icon name="refresh-cw" [size]="13" />{{ 'help.lifecycle.loopPending' | transloco }}</span>
          <span class="wf-loop" data-loop="stale"><ui-icon name="refresh-cw" [size]="13" />{{ 'help.lifecycle.loopStale' | transloco }}</span>
          <span class="wf-legend" data-lifecycle-legend>
            @for (tone of tones; track tone) {
              <span class="wf-key"><span class="wf-swatch" [attr.data-tone]="tone"></span>{{ 'help.lifecycle.tones.' + tone | transloco }}</span>
            }
            <span class="wf-key"><span class="wf-swatch optional"></span>{{ 'help.lifecycle.tones.optional' | transloco }}</span>
          </span>
        </figcaption>
      </figure>
    </ui-card>
  `,
  styleUrl: './help-lifecycle.css',
})
export class HelpLifecycle {
  protected readonly lifecycle = LIFECYCLE;
  protected readonly tones = LIFECYCLE_TONES;

  /** A file path cut after each `/` and `,`: where a narrow node may break the line. */
  protected parts(file: string): readonly string[] {
    return file.split(/(?<=[/,])/u);
  }
}
