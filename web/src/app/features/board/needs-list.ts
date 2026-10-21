import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { BoardCard } from '../../core/model/board-types';
import { cardLinkOf } from './board-view';

/**
 * The cards waiting on you in the compact sheet (spec 024, design § Mobile; spec 061): one link per card to its spec
 * or story, with its id, title and reason (else its stage).
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- an attribute on the sheet's <ul>, so the sheet keeps its list element
  selector: 'ul[app-needs-list]',
  imports: [RouterLink, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './needs-list.html',
  styleUrl: './needs-list.css',
})
export class NeedsList {
  readonly cards = input.required<readonly BoardCard[]>();
  readonly ws = input.required<string>();
  /** A card's link was followed: the sheet closes. */
  readonly picked = output();

  protected link(card: BoardCard): string[] {
    return cardLinkOf(this.ws(), card);
  }
}
