import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ApiClient } from '../api-client';
import { FooStore } from './foo.store';

// Fixture for the page rule (spec 061, ISC-437): a listed page component injects its store and the `ApiClient`;
// the guard finds no violation here.
@Component({
  selector: 'app-foo-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [FooStore],
  templateUrl: './foo-page.html',
})
export class FooPage {
  protected readonly store = inject(FooStore);
  private readonly api = inject(ApiClient);
  protected readonly base = this.api.base;
}
