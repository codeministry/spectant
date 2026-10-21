import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ApiClient } from '../api-client';

// Fixture for the page rule (spec 061, ISC-437): a part component may inject the router, but not the `ApiClient`;
// the guard reports the `ApiClient` only.
@Component({
  selector: 'app-bar-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './bar-list.html',
})
export class BarList {
  private readonly router = inject(Router);
  private readonly api = inject(ApiClient);
  protected readonly base = this.api.base;
  protected readonly url = this.router.url;
}
