import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * A key cap (`⌘K`, `Esc`, `?`): a real `<kbd>` (spec 024, ISC-148): 20 px high and at least
 * 20 wide, mono 500 11/11 centred, 1 px `--line` border with a 2 px bottom, 4 px radius, on `--lane`.
 */
@Component({
  selector: 'ui-kbd',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './kbd.css',
  templateUrl: './kbd.html',
})
export class UiKbd {}
