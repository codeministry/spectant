import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { pathSegments } from '../../../core/model/path-segments';

/**
 * A file path inside its `<code>` with a line break offered after each `/` (`<wbr>`) and nowhere else (spec 061): the
 * gate button's changed files and the reviewed files of the Status tab's Gates card. An attribute component, so the
 * `<code>` stays the host template's own element with its styles; the segments carry no styles of their own.
 */
@Component({
  // Attribute-style on purpose: the host template's <code> is the host, so the DOM keeps its shape.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'code[ui-path-breaks]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './path-breaks.html',
})
export class UiPathBreaks {
  /** The path as the payload lists it, e.g. `specs/012-x/spec.md`. */
  readonly path = input.required<string>();
  protected readonly segments = computed(() => pathSegments(this.path()));
}
