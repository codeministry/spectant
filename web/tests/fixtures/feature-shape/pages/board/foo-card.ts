import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FooStore } from './foo.store';

// Fixture for the page rule (spec 061, ISC-437): a part component that injects a store instead of taking its data
// through `input()`; the guard reports it.
@Component({
  selector: 'app-foo-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './foo-card.html',
})
export class FooCard {
  readonly title = input('');
  protected readonly store = inject(FooStore);
}
