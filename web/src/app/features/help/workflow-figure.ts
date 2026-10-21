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
  templateUrl: './workflow-figure.html',
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
