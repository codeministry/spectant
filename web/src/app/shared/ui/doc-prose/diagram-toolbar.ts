import { booleanAttribute, ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIcon } from '../../icons/icon';
import type { DiagramZoom } from './diagram-zoom';

/**
 * The toolbar of a drawn diagram (design.md § Mermaid toolbar, ISC-154.1): zoom out, the level, zoom in,
 * reset, and full screen (in the full screen dialog: exit full screen). `ui-doc-prose` mounts one into each rendered
 * mermaid figure and one into its full screen dialog; the styles live in `doc-prose.css` (the figure's hover and
 * focus decide its visibility). A bound's button is `aria-disabled`, not `disabled`, so focus stays on it.
 */
@Component({
  selector: 'ui-diagram-toolbar',
  imports: [TranslocoPipe, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-fullscreen]': 'fullscreen() ? "" : null' },
  template: `
    <div class="diagram-toolbar" role="toolbar" [attr.aria-label]="'docProse.diagram.toolbar' | transloco">
      <button
        type="button"
        class="diagram-tool"
        [attr.aria-label]="'docProse.diagram.zoomOut' | transloco"
        [attr.title]="'docProse.diagram.zoomOut' | transloco"
        [attr.aria-disabled]="zoom().atMin() ? 'true' : null"
        (click)="zoom().zoomOut()"
      >
        <ui-icon name="zoom-out" [size]="16" />
      </button>
      <span class="diagram-zoom-level" data-zoom-level>{{ zoom().percent() }} %</span>
      <button
        type="button"
        class="diagram-tool"
        [attr.aria-label]="'docProse.diagram.zoomIn' | transloco"
        [attr.title]="'docProse.diagram.zoomIn' | transloco"
        [attr.aria-disabled]="zoom().atMax() ? 'true' : null"
        (click)="zoom().zoomIn()"
      >
        <ui-icon name="zoom-in" [size]="16" />
      </button>
      <button
        type="button"
        class="diagram-tool"
        [attr.aria-label]="'docProse.diagram.reset' | transloco"
        [attr.title]="'docProse.diagram.reset' | transloco"
        (click)="zoom().reset()"
      >
        <ui-icon name="rotate-ccw" [size]="16" />
      </button>
      <span class="diagram-tool-rule" aria-hidden="true"></span>
      @let screen = fullscreen() ? 'docProse.diagram.exitFullscreen' : 'docProse.diagram.fullscreen';
      <button
        type="button"
        class="diagram-tool"
        [attr.aria-label]="screen | transloco"
        [attr.title]="screen | transloco"
        (click)="screenToggle.emit()"
      >
        <ui-icon [name]="fullscreen() ? 'minimize-2' : 'maximize-2'" [size]="16" />
      </button>
    </div>
  `,
})
export class UiDiagramToolbar {
  readonly zoom = input.required<DiagramZoom>();
  /** In the full screen dialog: always shown, and the last button leaves full screen. */
  readonly fullscreen = input(false, { transform: booleanAttribute });
  /** Full screen on, or (in the dialog) off. */
  readonly screenToggle = output();
}
