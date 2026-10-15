import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIcon } from '../../shared/icons/icon';
import { FIGURE, SHIELD_CHECK, type WorkflowLayout } from './workflow-diagram';

/**
 * One workflow figure of the Help page (spec 008, ISC-123, T161): the layout model of `workflowLayout` drawn as a
 * token-themed inline SVG, left to right, synchronously (no render run, so `data-rendered` holds from the first
 * paint). Stage nodes are 32 px rounded rectangles with a left edge in the stage's role colour; each fixed gate is a
 * double-framed node with a shield-check annotation above it; build ⇄ blocked and the close-pending branch are arcs
 * under the line; an optional step (the design pass, a voluntary code review) is dotted, and so are its arrows. The SVG is `role="img"` with the caller's translated `label`; its words come in through the model.
 * The canvas scrolls sideways inside itself when the figure is wider than the panel; the page never does.
 */
@Component({
  selector: 'app-workflow-figure',
  imports: [TranslocoPipe, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-rendered]': "layout().nodes.length > 0 ? '' : null" },
  styleUrl: './workflow-figure.css',
  template: `
    @if (legend()) {
      <ul class="legend" data-workflow-legend aria-hidden="true">
        <li><i class="swatch" data-role="moving"></i>{{ 'help.workflow.legend.moving' | transloco }}</li>
        <li><i class="swatch" data-role="waits"></i>{{ 'help.workflow.legend.waits' | transloco }}</li>
        <li><i class="swatch" data-role="done"></i>{{ 'help.workflow.legend.done' | transloco }}</li>
        <li><i class="swatch" data-role="detour"></i>{{ 'help.workflow.legend.detour' | transloco }}</li>
        <li><i class="swatch" data-role="optional"></i>{{ 'help.workflow.legend.optional' | transloco }}</li>
        <li><ui-icon name="shield-check" [size]="14" />{{ 'help.workflow.legend.gate' | transloco }}</li>
      </ul>
    }
    <div class="canvas">
      <svg
        data-icon-exempt
        role="img"
        focusable="false"
        [attr.aria-label]="label()"
        [attr.viewBox]="viewBox()"
        [attr.width]="layout().size.width"
        [attr.height]="layout().size.height"
        [style.--wf-width.px]="layout().size.width"
      >
        @for (edge of layout().edges; track $index) {
          <g class="edge" [attr.data-edge]="edge.from + ' ' + edge.to" [attr.data-kind]="edge.kind">
            <path class="line" [attr.d]="edge.path" />
            <polygon class="head" [attr.points]="edge.head" />
          </g>
        }
        @for (node of layout().nodes; track node.stage) {
          <g
            class="node"
            [attr.data-stage]="node.stage"
            [attr.data-role]="node.role"
            [attr.data-detour]="node.detour ? '' : null"
            [attr.data-optional]="node.optional ? '' : null"
            [attr.data-gate]="node.gate"
            [style.--edge]="node.edge"
          >
            <rect class="box" rx="8" [attr.x]="node.x" [attr.y]="node.y" [attr.width]="node.width" [attr.height]="node.height" />
            @if (node.gate) {
              <rect class="frame" rx="5" [attr.x]="node.x + 3" [attr.y]="node.y + 3" [attr.width]="node.width - 6" [attr.height]="node.height - 6" />
            }
            <rect class="bar" width="3" rx="1.5" [attr.x]="node.x + 7" [attr.y]="node.y + 8" [attr.height]="node.height - 16" />
            <text text-anchor="middle" dominant-baseline="central" [attr.x]="node.textX" [attr.y]="node.textY">{{ node.label }}</text>
          </g>
        }
        @for (gate of layout().gates; track gate.stage) {
          <g class="gate" [attr.data-gate-note]="gate.kind">
            <g class="glyph" [attr.transform]="'translate(' + gate.iconX + ' ' + gate.iconY + ') scale(' + iconScale + ')'">
              @for (d of shield; track $index) {
                <path [attr.d]="d" />
              }
            </g>
            <text class="gate-label" dominant-baseline="central" [attr.x]="gate.textX" [attr.y]="gate.textY">{{ gate.label }}</text>
          </g>
        }
      </svg>
    </div>
  `,
})
export class WorkflowFigure {
  readonly layout = input.required<WorkflowLayout>();
  /** The figure's accessible name, translated by the caller: the type, its stages, detours and gates. */
  readonly label = input.required<string>();
  /** Shows the colour legend above the canvas; the page asks for it on the first figure only. */
  readonly legend = input(false);

  protected readonly shield = SHIELD_CHECK;
  /** The 24-unit icon grid scaled down to the glyph's size. */
  protected readonly iconScale = FIGURE.iconSize / 24;
  protected readonly viewBox = computed(() => `0 0 ${String(this.layout().size.width)} ${String(this.layout().size.height)}`);
}
