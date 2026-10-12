import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * A key cap (`⌘K`, `Esc`, `?`): a real `<kbd>`, the prototype's `kbd` (spec 024, ISC-148): 20 px high and at least
 * 20 wide, mono 500 11/11 centred, 1 px `--line` border with a 2 px bottom, 4 px radius, on `--lane`.
 */
@Component({
  selector: 'ui-kbd',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: inline-flex; }
    kbd { display: inline-flex; align-items: center; justify-content: center; min-inline-size: 20px; block-size: 20px; padding-inline: 5px; border: 1px solid var(--line); border-block-end-width: 2px; border-radius: 4px; background: var(--lane); color: var(--muted-ink); font-family: var(--font-mono); font-size: 11px; font-weight: 500; line-height: 11px; }
  `,
  template: `<kbd><ng-content /></kbd>`,
})
export class UiKbd {}
