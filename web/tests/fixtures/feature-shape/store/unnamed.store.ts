import { Injectable, signal } from '@angular/core';

// Fixture for the store shape (spec 061, ISC-436): an injectable whose class name does not end in `Store`, so the
// file holds no store and the guard reports it.
@Injectable()
export class Unnamed {
  readonly value = signal(0);
}
