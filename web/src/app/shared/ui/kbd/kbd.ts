import { ChangeDetectionStrategy, Component } from '@angular/core';

/** A key cap (`⌘K`, `Esc`, `?`): a real `<kbd>`, mono 12/16, 1 px `--line` border, 4 px radius. */
@Component({
  selector: 'ui-kbd',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: inline-flex; }
    kbd { display: inline-block; min-inline-size: 20px; padding-inline: 4px; border: 1px solid var(--line); border-radius: 4px; background: var(--color-base-200); color: var(--muted-ink); font-family: var(--font-mono); font-size: 12px; line-height: 16px; text-align: center; }
  `,
  template: `<kbd><ng-content /></kbd>`,
})
export class UiKbd {}
