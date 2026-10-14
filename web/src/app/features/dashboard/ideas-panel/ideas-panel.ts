import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { DetailSelection, selectedLook } from '../../../layout/detail-sidebar/selection';
import { UiCard } from '../../../shared/ui/card/card';
import { UiIdeaChip } from '../../../shared/ui/idea-chip/idea-chip';
import { UiDisclosure } from '../../../shared/ui/overlay/disclosure';

/** One story as `DashboardModel.ideas.list` carries it; only these fields are read. */
export interface DashboardIdea {
  readonly slug: string;
  readonly title: string;
  readonly feature: string | null;
  readonly milestone: string | null;
  readonly priority: string;
}

/** `DashboardModel.ideas`: the backlog's stories and their count, as served. */
export interface DashboardIdeas {
  readonly count: number;
  readonly list: readonly DashboardIdea[];
}

/**
 * The backlog on the dashboard (T138, ISC-124.2, design 008 § ideas on the existing pages): after the Specs panel, one
 * `ui-disclosure` "Ideas · n", collapsed by default so the backlog never buries the work, at every tier (it is the
 * desktop's closing group of the spec list). Each story is its `ui-idea-chip` with feature and milestone as muted text
 * beside it, in the model's order; the count is the model's. Nothing renders while the model carries no story.
 *
 * Spec 026 (T28, ISC-171): a plain click (or Enter) on a chip selects the story for the detail sidebar
 * (`?sel=idea:<slug>`), the row taking the selection look; Shift opens the idea page in place, and a Ctrl/Cmd or middle
 * click keeps the browser's new-tab default. The page docks the sidebar, so at wide it stands in for the rail.
 */
@Component({
  selector: 'app-ideas-panel',
  imports: [TranslocoPipe, UiCard, UiDisclosure, UiIdeaChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./ideas-panel.css', '../../../layout/detail-sidebar/selection.css'],
  host: { '[attr.data-ideas]': 'ideas().count > 0 ? ideas().count : null', '(click)': 'open($event)' },
  template: `
    @if (ideas().count > 0) {
      <ui-card [padding]="0" class="panel">
        <ui-disclosure class="fold">
          <span uiDisclosureSummary class="title" data-ideas-title>{{ 'specs.ideas.title' | transloco: { count: ideas().count } }}</span>
          <ul class="list" [attr.aria-label]="'specs.ideas.label' | transloco">
            @for (idea of ideas().list; track idea.slug) {
              @let where = whereOf(idea);
              <li [attr.data-idea]="idea.slug" [attr.data-selected]="look(idea.slug)">
                <ui-idea-chip [ws]="ws()" [slug]="idea.slug" [title]="idea.title" [ref]="'idea:' + idea.slug" />
                @if (where !== '') {
                  <span class="where" data-idea-where>{{ where }}</span>
                }
              </li>
            }
          </ul>
        </ui-disclosure>
      </ui-card>
    }
  `,
})
export class IdeasPanel {
  readonly ws = input.required<string>();
  readonly ideas = input.required<DashboardIdeas>();
  private readonly selection = inject(DetailSelection);

  protected look(slug: string): 'row' | null {
    return selectedLook(this.selection, `idea:${slug}`, 'row') === 'row' ? 'row' : null;
  }

  /** A click on a story's chip: select it, or with Shift let the link open the idea page; modified clicks stay native. */
  protected open(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const slug = target?.closest('a') ? target.closest<HTMLElement>('li[data-idea]')?.dataset['idea'] : undefined;
    if (slug === undefined || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    void this.selection.select(`idea:${slug}`);
  }

  /** Feature and milestone, whichever the story names, as the muted text beside its chip. */
  protected whereOf(idea: DashboardIdea): string {
    return [idea.feature, idea.milestone].filter((part): part is string => part !== null && part !== '').join(' · ');
  }
}
