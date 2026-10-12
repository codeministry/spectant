import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The tech page at `/w/:ws/tech/<tab>` (spec 023, ISC-134.1): a placeholder holding only its host so the routes
 * resolve; the page task (T14) replaces it with the head, the main tab-bar slot and the five panels. One instance
 * stays across tab switches: the tab routes are its componentless children.
 */
@Component({
  selector: 'app-tech-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'tech' },
  template: '',
})
export class TechPage {}
