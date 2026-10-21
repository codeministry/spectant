import { ChangeDetectionStrategy, Component } from '@angular/core';

/** A spec or claim ID ("012", "ISC-334"): mono 13/20, weight 600, in the primary ink (`--disp-ink`, ISC-65). */
@Component({
  selector: 'ui-id-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './id-chip.css',
  templateUrl: './id-chip.html',
})
export class UiIdChip {}
