// Placeholder for `/w/:ws/ideas/:slug` (T115); T131 renders the story read-only.
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NotFound } from '../../layout/not-found/not-found';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiCard } from '../../shared/ui/card/card';

/**
 * A story of `specs/ideas/` (spec 008, ISC-124.2). A slug the workspace's planning tree does not list, or an unknown
 * workspace, renders the not-found page (ISC-71); unknown while the tree loads, so nothing flashes.
 */
@Component({
  selector: 'app-idea-page',
  imports: [NotFound, TranslocoPipe, UiCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'idea' },
  styles: `
    :host { display: block; }
    h1 { margin: 0 0 8px; font-family: var(--font-display); font-size: 24px; font-weight: 600; line-height: 32px; }
    p { margin: 0; color: var(--muted-ink); font-family: var(--font-mono); font-size: 13px; line-height: 20px; }
  `,
  template: `
    @if (missing()) {
      <app-not-found />
    } @else {
      <ui-card [padding]="24">
        <h1 id="idea" tabindex="-1">{{ 'ideas.title' | transloco }}</h1>
        <p data-slug>{{ slug() }}</p>
      </ui-card>
    }
  `,
})
export class IdeaPage {
  private readonly state = inject(ShellState);
  private readonly data = inject(ShellData);

  protected readonly slug = computed(() => this.state.route().ideaSlug ?? '');

  protected readonly missing = computed(() => {
    if (this.data.workspaceMissing() || this.data.planningMissing()) return true;
    return this.data.planningModel() !== null && !this.data.ideas().some((idea) => idea.slug === this.slug());
  });
}
