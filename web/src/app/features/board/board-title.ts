import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiPageHead } from '../../shared/ui/page-head/page-head';
import { UiWsBadge } from '../../shared/ui/ws-badge/ws-badge';

/**
 * The board's page head (T163, ISC-140; spec 024; spec 061): `ui-page-head` with the workspace badge, the "Board" h1
 * and the muted "· <ws>" suffix, then the chip naming the workflow the columns come from (ISC-122).
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- an attribute on the page's title row <div>, so the head keeps its element
  selector: 'div[app-board-title]',
  imports: [TranslocoPipe, UiPageHead, UiWsBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './board-title.html',
  styleUrl: './board-title.css',
})
export class BoardTitle {
  /** The eyebrow's segments, already translated. */
  readonly segments = input.required<readonly string[]>();
  /** The workspace's name: the badge and the suffix. */
  readonly name = input.required<string>();
  /** The workflow's source: the workspace's own table (`file`), the default one, or none read yet. */
  readonly source = input<string | null>(null);
}
