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
  templateUrl: './diagram-toolbar.html',
})
export class UiDiagramToolbar {
  readonly zoom = input.required<DiagramZoom>();
  /** In the full screen dialog: always shown, and the last button leaves full screen. */
  readonly fullscreen = input(false, { transform: booleanAttribute });
  /** Full screen on, or (in the dialog) off. */
  readonly screenToggle = output();
}
