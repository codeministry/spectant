import { Injectable } from '@angular/core';

// Fixture for the page rule (spec 061, ISC-437): a stand-in for the app's `ApiClient`, matched by its name.
@Injectable({ providedIn: 'root' })
export class ApiClient {
  readonly base = '/api';
}
