import { ChangeDetectionStrategy, Component } from '@angular/core';

/** A spec or claim ID ("012", "ISC-334"): mono 13/20, weight 600, in the primary ink (`--disp-ink`, ISC-65). */
@Component({
  selector: 'ui-id-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: inline-block; color: var(--disp-ink); font-family: var(--font-mono); font-size: 13px; font-variant-numeric: tabular-nums; font-weight: 600; line-height: 20px; white-space: nowrap; }
  `,
  template: `<ng-content />`,
})
export class UiIdChip {}
