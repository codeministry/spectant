import { DOCUMENT } from '@angular/common';
import { ElementRef, inject, Injectable, signal } from '@angular/core';

// The guard tests type-check without the DOM library, so the browser global this fixture reaches for is declared here.
declare const window: { readonly scrollY: number };

// Fixture for the store shape (spec 061, ISC-436): a store that reaches the DOM three ways, through `DOCUMENT`,
// through `ElementRef` and through the `window` global. The guard reports each of them. A mention of document.title
// or window.scrollY in this comment, or in a string, is prose and no hit.
@Injectable()
export class DomStore {
  private readonly doc = inject<unknown>(DOCUMENT);
  private readonly host = inject(ElementRef);
  readonly label = signal('window.scrollY');

  scrollTop(): number {
    return this.doc === this.host ? 0 : window.scrollY;
  }
}
