import { inject, Injectable, signal } from '@angular/core';
import { ApiClient } from '../api-client';

// Fixture for the page rule (spec 061, ISC-437): a store may inject the `ApiClient`; only components are checked.
@Injectable()
export class FooStore {
  private readonly api = inject(ApiClient);
  readonly base = signal(this.api.base);
}
